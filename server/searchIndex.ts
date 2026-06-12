import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { INDEX_DIR, ACCOUNTS, REGEX_MAX_PATTERN_LENGTH, REGEX_TIMEOUT_MS } from './config.js';
import { foldTurkish } from './fold.js';
import { maskSecrets } from './mask.js';
import { globalRepoRegistry } from './sync.js';

// Owners that belong to the configured accounts. The account checkbox filter
// only governs these; external repos (any other owner) are exempt and are
// controlled solely by the repo filter — so adding an external repo makes it
// searchable without unchecking your own accounts.
const CONFIGURED_OWNERS = new Set(ACCOUNTS.map(a => a.login.toLowerCase()));

export interface IndexedFile {
  owner: string;
  repo: string;
  path: string;
  lines: string[];
  foldedLines: string[];
}

export interface MatchRange {
  start: number;
  length: number;
}

export interface SearchResult {
  owner: string;
  repo: string;
  path: string;
  line: string;
  lineNumber: number | null; // null = fragment without a known line (live mode)
  before: string | null;
  after: string | null;
  matchRanges: MatchRange[];
}

export interface SearchResponse {
  results: SearchResult[];
  pathMatches: Array<{ owner: string; repo: string; path: string }>;
  totalFound: number;
  truncated: boolean;
  tookMs: number;
  apiCallsUsed: number;
  explanation?: string;
}

// In-memory code search index
let memoryIndex: IndexedFile[] = [];

export function getMemoryIndex(): IndexedFile[] {
  return memoryIndex;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ParsedQuery {
  exactPhrases: string[];
  positiveTerms: string[];
  negativeTerms: string[];
}

/**
 * Parses double-quoted exact phrases and minus-prefixed exclusion terms.
 */
export function parseBooleanQuery(q: string, fold: boolean, caseSensitive: boolean): ParsedQuery {
  const normalize = (s: string) => {
    let res = s;
    if (fold) {
      res = foldTurkish(res);
    } else if (!caseSensitive) {
      res = res.toLowerCase();
    }
    return res;
  };

  const exactPhrases: string[] = [];
  const positiveTerms: string[] = [];
  const negativeTerms: string[] = [];

  const regexQuoted = /"([^"]+)"/g;
  let match;
  let cleaned = q;
  while ((match = regexQuoted.exec(q)) !== null) {
    if (match[1].trim()) {
      exactPhrases.push(normalize(match[1]));
    }
    cleaned = cleaned.replace(match[0], ' ');
  }

  const parts = cleaned.split(/\s+/).filter(Boolean);
  for (const part of parts) {
    if (part.startsWith('-') && part.length > 1) {
      negativeTerms.push(normalize(part.substring(1)));
    } else {
      positiveTerms.push(normalize(part));
    }
  }

  return { exactPhrases, positiveTerms, negativeTerms };
}

/**
 * Merges overlapping or touching ranges so highlighting stays consistent.
 */
export function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length === 0) return [];
  ranges.sort((a, b) => a.start - b.start);

  const merged: MatchRange[] = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    const curr = ranges[i];
    if (curr.start <= last.start + last.length) {
      last.length = Math.max(last.length, curr.start + curr.length - last.start);
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/**
 * Loads all compressed .json.gz shards from .cache/index into memory.
 * Lines are folded once at load time so searches never pay fold cost.
 */
export function loadIndexIntoMemory() {
  const start = Date.now();
  if (!fs.existsSync(INDEX_DIR)) {
    fs.mkdirSync(INDEX_DIR, { recursive: true });
  }

  const shards = fs.readdirSync(INDEX_DIR).filter(s => s.endsWith('.json.gz'));
  const newIndex: IndexedFile[] = [];

  for (const shard of shards) {
    const shardPath = path.join(INDEX_DIR, shard);
    try {
      const compressed = fs.readFileSync(shardPath);
      const decompressed = zlib.gunzipSync(compressed).toString('utf8');
      const payload = JSON.parse(decompressed);

      const owner = payload.meta.owner;
      const repo = payload.meta.repo;

      if (Array.isArray(payload.files)) {
        for (const file of payload.files) {
          const rawLines = file.lines || [];
          const foldedLines = rawLines.map((line: string) => foldTurkish(line));

          newIndex.push({
            owner,
            repo,
            path: file.path,
            lines: rawLines,
            foldedLines
          });
        }
      }
    } catch (err) {
      console.error(`Failed to load index shard ${shard}:`, err);
    }
  }

  memoryIndex = newIndex;
  console.log(`[SearchIndex] Memory index loaded. Indexed files: ${memoryIndex.length}. Took ${Date.now() - start}ms.`);
}

/**
 * Reload after a sync: refreshes both the main-thread copy and the regex worker's.
 */
export function reloadIndex() {
  loadIndexIntoMemory();
  notifyRegexWorkerReload();
}

// ---------------------------------------------------------------------------
// Regex execution lives in a worker thread: catastrophic backtracking inside a
// single .match() call is uninterruptible in-thread, so the only real defense
// is worker.terminate() on a hard deadline. The worker keeps its own lazy copy
// of the index (loaded from the same shards).
// ---------------------------------------------------------------------------

interface WorkerSearchOk {
  id: number;
  results: Array<{
    owner: string; repo: string; path: string; lineNumber: number;
    line: string; before: string | null; after: string | null; matchRanges: MatchRange[];
  }>;
  totalFound: number;
  truncated: boolean;
}

let regexWorker: Worker | null = null;
let workerSeq = 0;
const pendingWorkerCalls = new Map<number, { resolve: (v: WorkerSearchOk) => void; reject: (e: Error) => void }>();

function workerPath(): string {
  return fileURLToPath(new URL('./regexWorker.mjs', import.meta.url));
}

function getRegexWorker(): Worker {
  if (regexWorker) return regexWorker;
  regexWorker = new Worker(workerPath(), { workerData: { indexDir: INDEX_DIR } });
  regexWorker.on('message', (msg: any) => {
    const pending = pendingWorkerCalls.get(msg.id);
    if (!pending) return;
    pendingWorkerCalls.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg as WorkerSearchOk);
    }
  });
  regexWorker.on('error', (err) => {
    for (const [, p] of pendingWorkerCalls) p.reject(err);
    pendingWorkerCalls.clear();
    regexWorker = null;
  });
  regexWorker.on('exit', () => {
    regexWorker = null;
  });
  return regexWorker;
}

function notifyRegexWorkerReload() {
  if (regexWorker) {
    try {
      regexWorker.postMessage({ type: 'reload' });
    } catch {}
  }
}

function killRegexWorker() {
  if (regexWorker) {
    const w = regexWorker;
    regexWorker = null;
    w.terminate().catch(() => {});
  }
}

async function runRegexInWorker(params: {
  pattern: string;
  flags: string;
  plane: 'raw' | 'lower' | 'folded';
  filters: { accounts?: string[]; repos?: string[]; pathQuery?: string; ext?: string; configuredOwners?: string[] };
  limit: number;
}): Promise<WorkerSearchOk> {
  const id = ++workerSeq;
  const worker = getRegexWorker();

  return new Promise<WorkerSearchOk>((resolve, reject) => {
    // Hard deadline: a hung worker (single-line catastrophic backtracking)
    // never posts back — terminate it and respawn lazily on the next search.
    const deadline = setTimeout(() => {
      pendingWorkerCalls.delete(id);
      killRegexWorker();
      reject(new Error('Pattern is executing too slow (timeout). Please refine your regex expression.'));
    }, REGEX_TIMEOUT_MS + 500);

    pendingWorkerCalls.set(id, {
      resolve: (v) => {
        clearTimeout(deadline);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(deadline);
        reject(e);
      }
    });

    worker.postMessage({
      type: 'search',
      id,
      pattern: params.pattern,
      flags: params.flags,
      plane: params.plane,
      filters: params.filters,
      limit: params.limit,
      timeBudgetMs: REGEX_TIMEOUT_MS
    });
  });
}

// ---------------------------------------------------------------------------

/**
 * Searches the in-memory mirror index. Async because regex mode is delegated
 * to the guarded worker thread.
 */
export async function searchMirror(params: {
  q: string;
  regex: boolean;
  word: boolean;
  caseSensitive: boolean;
  fold: boolean;
  accounts?: string[];
  repos?: string[];
  pathQuery?: string;
  ext?: string;
  limit?: number;
}): Promise<SearchResponse> {
  const startTime = Date.now();
  const limit = params.limit || 500;

  const rawQuery = params.q;
  if (!rawQuery) {
    return { results: [], pathMatches: [], totalFound: 0, truncated: false, tookMs: 0, apiCallsUsed: 0 };
  }

  // Plane selection is shared by every mode: fold beats case beats lower.
  const plane: 'raw' | 'lower' | 'folded' = params.fold ? 'folded' : (params.caseSensitive ? 'raw' : 'lower');
  const processQuery = (s: string) => params.fold ? foldTurkish(s) : (params.caseSensitive ? s : s.toLowerCase());

  // -------------------------------------------------------------------------
  // Regex mode → worker
  // -------------------------------------------------------------------------
  if (params.regex) {
    if (rawQuery.length > REGEX_MAX_PATTERN_LENGTH) {
      throw new Error(`Regex pattern too long (max ${REGEX_MAX_PATTERN_LENGTH} characters).`);
    }
    // Compile here first for a fast, friendly invalid-pattern error.
    const flags = params.caseSensitive ? 'u' : 'ui';
    try {
      // eslint-disable-next-line no-new
      new RegExp(rawQuery, flags);
    } catch (err: any) {
      throw new Error(`Invalid search regex pattern: ${err.message}`);
    }

    const workerResult = await runRegexInWorker({
      pattern: rawQuery,
      flags,
      plane,
      filters: {
        accounts: params.accounts,
        repos: params.repos,
        pathQuery: params.pathQuery,
        ext: params.ext,
        configuredOwners: [...CONFIGURED_OWNERS]
      },
      limit
    }).catch((err: Error) => {
      if (err.message === 'REGEX_TIMEOUT') {
        throw new Error('Pattern is executing too slow (timeout). Please refine your regex expression.');
      }
      throw err;
    });

    const results: SearchResult[] = workerResult.results.map(r => ({
      owner: r.owner,
      repo: r.repo,
      path: r.path,
      line: maskSecrets(r.line),
      lineNumber: r.lineNumber,
      before: r.before ? maskSecrets(r.before) : null,
      after: r.after ? maskSecrets(r.after) : null,
      matchRanges: r.matchRanges
    }));

    return {
      results,
      pathMatches: [],
      totalFound: workerResult.totalFound,
      truncated: workerResult.truncated,
      tookMs: Date.now() - startTime,
      apiCallsUsed: 0
    };
  }

  // -------------------------------------------------------------------------
  // Substring (boolean query) & whole-word modes — main thread, linear scan
  // -------------------------------------------------------------------------
  const results: SearchResult[] = [];
  const pathMatches: Array<{ owner: string; repo: string; path: string }> = [];

  const accountFilter = params.accounts && params.accounts.length > 0 ? new Set(params.accounts) : null;
  const repoFilter = params.repos && params.repos.length > 0 ? new Set(params.repos) : null;
  const pathRegex = params.pathQuery ? new RegExp(escapeRegExp(params.pathQuery), 'i') : null;
  const extFilter = params.ext ? params.ext.toLowerCase().trim().replace(/^\./, '') : null;

  let textMatcher: (line: string, foldedLine: string) => MatchRange[] | null;

  if (params.word) {
    // Whole-word: the pattern is built from the PROCESSED query and matched on
    // the SAME plane the ranges index into. The previous implementation built
    // it from the raw query but matched the folded plane, so a Turkish query
    // with fold ON could never match; it also reported only the first hit.
    const processedQuery = processQuery(rawQuery);
    const escaped = escapeRegExp(processedQuery);
    const wordRegex = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_])`, 'gu');

    textMatcher = (line: string, foldedLine: string) => {
      const target = plane === 'folded' ? foldedLine : (plane === 'raw' ? line : line.toLowerCase());
      let ranges: MatchRange[] | null = null;
      for (const m of target.matchAll(wordRegex)) {
        const start = (m.index ?? 0) + m[1].length;
        if (!ranges) ranges = [];
        ranges.push({ start, length: m[2].length });
      }
      return ranges;
    };
  } else {
    // Boolean substring engine: "exact phrases", -negations, AND terms.
    const parsedQuery = parseBooleanQuery(rawQuery, params.fold, params.caseSensitive);

    textMatcher = (line: string, foldedLine: string) => {
      const targetStr = plane === 'folded' ? foldedLine : (plane === 'raw' ? line : line.toLowerCase());

      for (const neg of parsedQuery.negativeTerms) {
        if (targetStr.includes(neg)) {
          return null;
        }
      }

      for (const phrase of parsedQuery.exactPhrases) {
        if (!targetStr.includes(phrase)) {
          return null;
        }
      }

      for (const term of parsedQuery.positiveTerms) {
        if (!targetStr.includes(term)) {
          return null;
        }
      }

      const ranges: MatchRange[] = [];

      for (const phrase of parsedQuery.exactPhrases) {
        let index = targetStr.indexOf(phrase);
        while (index !== -1) {
          ranges.push({ start: index, length: phrase.length });
          index = targetStr.indexOf(phrase, index + phrase.length);
        }
      }

      for (const term of parsedQuery.positiveTerms) {
        let index = targetStr.indexOf(term);
        while (index !== -1) {
          ranges.push({ start: index, length: term.length });
          index = targetStr.indexOf(term, index + term.length);
        }
      }

      if (ranges.length === 0) {
        // negations-only query that passed the checks: match without highlight
        return parsedQuery.negativeTerms.length > 0 ? [] : null;
      }

      return mergeRanges(ranges);
    };
  }

  let totalFound = 0;
  let isTruncated = false;
  const queryCompareStr = processQuery(rawQuery);

  for (const file of memoryIndex) {
    const key = `${file.owner}/${file.repo}`;

    // Account filter only constrains configured-account owners; external repos
    // are exempt (governed by the repo filter alone).
    if (accountFilter && CONFIGURED_OWNERS.has(file.owner.toLowerCase()) && !accountFilter.has(file.owner)) continue;
    if (repoFilter && !repoFilter.has(key)) continue;
    if (pathRegex && !pathRegex.test(file.path)) continue;
    if (extFilter) {
      const fileExt = file.path.split('.').pop()?.toLowerCase();
      if (fileExt !== extFilter) continue;
    }

    // Path/repo-name hits render pinned above content hits.
    const pathCompareStr = processQuery(file.path);
    if (pathCompareStr.includes(queryCompareStr) || foldTurkish(key).includes(foldTurkish(rawQuery))) {
      pathMatches.push({
        owner: file.owner,
        repo: file.repo,
        path: file.path
      });
    }

    const lineCount = file.lines.length;
    for (let i = 0; i < lineCount; i++) {
      const rawLine = file.lines[i];
      const foldedLine = file.foldedLines[i];

      const matchRanges = textMatcher(rawLine, foldedLine);
      if (matchRanges) {
        totalFound++;

        if (results.length < limit) {
          const before = i > 0 ? file.lines[i - 1] : null;
          const after = i < lineCount - 1 ? file.lines[i + 1] : null;

          results.push({
            owner: file.owner,
            repo: file.repo,
            path: file.path,
            line: maskSecrets(rawLine),
            lineNumber: i + 1,
            before: before ? maskSecrets(before) : null,
            after: after ? maskSecrets(after) : null,
            matchRanges
          });
        } else {
          isTruncated = true;
        }
      }
    }
  }

  // Most recently pushed repos first
  const sortedResults = [...results].sort((a, b) => {
    const pA = globalRepoRegistry[`${a.owner}/${a.repo}`]?.pushedAt || '';
    const pB = globalRepoRegistry[`${b.owner}/${b.repo}`]?.pushedAt || '';
    return new Date(pB).getTime() - new Date(pA).getTime();
  });

  return {
    results: sortedResults,
    pathMatches: pathMatches.slice(0, 50),
    totalFound,
    truncated: isTruncated,
    tookMs: Date.now() - startTime,
    apiCallsUsed: 0
  };
}
