import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { INDEX_DIR } from './config.js';
import { foldTurkish } from './fold.ts';
import { maskSecrets } from './mask.ts';
import { globalRepoRegistry } from './sync.ts';

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
  lineNumber: number; // 1-indexed
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
}

// In-memory code search index
let memoryIndex: IndexedFile[] = [];
let lastLoadTime = 0;

export function getMemoryIndex(): IndexedFile[] {
  return memoryIndex;
}

/**
 * Escapes special characters for usage in regular expressions.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface ParsedQuery {
  exactPhrases: string[];
  positiveTerms: string[];
  negativeTerms: string[];
}

/**
 * Parses double-quoted exact match substrings and negative exclusion terms starting with minus (-)
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

  // Match quoted phrases
  const regexQuoted = /"([^"]+)"/g;
  let match;
  let cleaned = q;
  while ((match = regexQuoted.exec(q)) !== null) {
    if (match[1].trim()) {
      exactPhrases.push(normalize(match[1]));
    }
    cleaned = cleaned.replace(match[0], ' ');
  }

  // Split remainder by spaces
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
 * Merges overlapping or touching MatchRanges to prevent front-end highlighting distortions
 */
export function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  if (ranges.length === 0) return [];
  // Sort by start position
  ranges.sort((a, b) => a.start - b.start);
  
  const merged: MatchRange[] = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    const curr = ranges[i];
    if (curr.start <= last.start + last.length) {
      // Overlap or touch, extend current range duration
      last.length = Math.max(last.length, curr.start + curr.length - last.start);
    } else {
      merged.push(curr);
    }
  }
  return merged;
}

/**
 * Loads all compressed .json.gz shards from .cache/index into memory.
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
          // Pre-fold lines at load-time once to save CPU budget during searches (MODE_QUANTUM_EFFICIENCY)
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
  lastLoadTime = Date.now();
  console.log(`[SearchIndex] Memory index loaded. Indexed files: ${memoryIndex.length}. Took ${Date.now() - start}ms.`);
}

/**
 * Public trigger to reload the search index
 */
export function reloadIndex() {
  loadIndexIntoMemory();
}

/**
 * Searches the in-memory mirror index according to user preferences.
 */
export function searchMirror(params: {
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
}): SearchResponse {
  const startTime = Date.now();
  const limit = params.limit || 500;
  
  const results: SearchResult[] = [];
  const pathMatches: Array<{ owner: string; repo: string; path: string }> = [];

  const rawQuery = params.q;
  if (!rawQuery) {
    return { results: [], pathMatches: [], totalFound: 0, truncated: false, tookMs: 0, apiCallsUsed: 0 };
  }

  // Pre-process filters
  const accountFilter = params.accounts && params.accounts.length > 0 ? new Set(params.accounts) : null;
  const repoFilter = params.repos && params.repos.length > 0 ? new Set(params.repos) : null;
  const pathRegex = params.pathQuery ? new RegExp(escapeRegExp(params.pathQuery), 'i') : null;
  const extFilter = params.ext ? params.ext.toLowerCase().trim().replace(/^\./, '') : null;

  // Compile Search Matcher Pattern
  let textMatcher: (line: string, foldedLine: string) => MatchRange[] | null = () => null;
  let slowRegexWatchdog = 0;
  
  if (params.regex) {
    // Regex Matching Engine with Safety watchdog (AC-12)
    try {
      const flags = params.caseSensitive ? 'u' : 'ui';
      const regexEngine = new RegExp(rawQuery, flags);

      textMatcher = (line: string) => {
        slowRegexWatchdog++;
        // Timeout watchdog checks time every 2,000 runs to protect server core loop
        if (slowRegexWatchdog % 2000 === 0) {
          const elapsed = Date.now() - startTime;
          if (elapsed > 2000) {
            throw new Error('REGEX_TIMEOUT');
          }
        }

        const match = line.match(regexEngine);
        if (match && match.index !== undefined) {
          return [{ start: match.index, length: match[0].length }];
        }
        return null;
      };
    } catch (err: any) {
      if (err.message === 'REGEX_TIMEOUT') throw err;
      // If regex pattern fails to compile: return empty immediately or throw
      throw new Error(`Invalid search regex pattern: ${err.message}`);
    }
  } else if (params.word) {
    // Whole-word matching engine using unicode bounds
    const escaped = escapeRegExp(rawQuery);
    const flags = params.caseSensitive ? 'u' : 'ui';
    const wordRegex = new RegExp(`(^|[^\\p{L}\\p{N}_])${escaped}($|[^\\p{L}\\p{N}_])`, flags);

    textMatcher = (line: string, foldedLine: string) => {
      const activeString = params.fold ? foldedLine : (params.caseSensitive ? line : line.toLowerCase());
      const queryValue = params.fold ? foldTurkish(rawQuery) : (params.caseSensitive ? rawQuery : rawQuery.toLowerCase());

      const match = activeString.match(wordRegex);
      if (match && match.index !== undefined) {
        // Aligns precisely within the raw line length
        const offset = match[1].length;
        const index = match.index + offset;
        return [{ start: index, length: queryValue.length }];
      }
      return null;
    };
  } else {
    // Advanced Boolean Parser + Negative Term exclusion + Substring Highlighting Engine
    const isFoldActive = params.fold;
    const isCase = params.caseSensitive;
    const parsedQuery = parseBooleanQuery(rawQuery, isFoldActive, isCase);

    textMatcher = (line: string, foldedLine: string) => {
      const targetStr = isFoldActive ? foldedLine : (isCase ? line : line.toLowerCase());

      // 1. Check negative exclusions first
      for (const neg of parsedQuery.negativeTerms) {
        if (targetStr.includes(neg)) {
          return null; // Skip line entirely
        }
      }

      // 2. Exact phrases must ALL match
      for (const phrase of parsedQuery.exactPhrases) {
        if (!targetStr.includes(phrase)) {
          return null; // Skip line
        }
      }

      // 3. Positive terms must ALL match
      for (const term of parsedQuery.positiveTerms) {
        if (!targetStr.includes(term)) {
          return null; // Skip line
        }
      }

      // 4. Gather multiple highlighted match ranges
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

      // If nothing to highlight but we still passed validation, return a full-row mock or default range
      if (ranges.length === 0) {
        if (parsedQuery.negativeTerms.length > 0) {
          return [];
        }
        return null;
      }

      // Merge overlap segments securely
      return mergeRanges(ranges);
    };
  }

  // 1. Process search indexes
  let totalFound = 0;
  let isTruncated = false;

  try {
    for (const file of memoryIndex) {
      const key = `${file.owner}/${file.repo}`;

      // Apply repo & account filters
      if (accountFilter && !accountFilter.has(file.owner)) continue;
      if (repoFilter && !repoFilter.has(key)) continue;

      // Apply path file query filter
      if (pathRegex && !pathRegex.test(file.path)) continue;

      // Apply extension filter
      if (extFilter) {
        const fileExt = file.path.split('.').pop()?.toLowerCase();
        if (fileExt !== extFilter) continue;
      }

      // Check path matching first (pinned hits on repo/path headers, AC-04)
      const pathCompareStr = params.fold ? foldTurkish(file.path) : (params.caseSensitive ? file.path : file.path.toLowerCase());
      const queryCompareStr = params.fold ? foldTurkish(rawQuery) : (params.caseSensitive ? rawQuery : rawQuery.toLowerCase());
      
      if (pathCompareStr.includes(queryCompareStr) || foldTurkish(`${file.owner}/${file.repo}`).includes(queryCompareStr)) {
        pathMatches.push({
          owner: file.owner,
          repo: file.repo,
          path: file.path
        });
      }

      // Read file body lines dynamically
      const lineCount = file.lines.length;
      for (let i = 0; i < lineCount; i++) {
        const rawLine = file.lines[i];
        const foldedLine = file.foldedLines[i];

        const matchRanges = textMatcher(rawLine, foldedLine);
        if (matchRanges && matchRanges.length > 0) {
          totalFound++;

          if (results.length < limit) {
            // Read context safely
            const before = i > 0 ? file.lines[i - 1] : null;
            const after = i < lineCount - 1 ? file.lines[i + 1] : null;

            results.push({
              owner: file.owner,
              repo: file.repo,
              path: file.path,
              // Mask sensitive secrets before handing to user interface (HC-3, HC-5)
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
  } catch (error: any) {
    if (error.message === 'REGEX_TIMEOUT') {
      throw new Error('Pattern is executing too slow (timeout). Please refine your regex expression.');
    }
    throw error;
  }

  // Sort matching results based on pushing sequence dates descending (M3)
  const sortedResults = [...results].sort((a, b) => {
    const keyA = `${a.owner}/${a.repo}`;
    const keyB = `${b.owner}/${b.repo}`;
    const pA = globalRepoRegistry[keyA]?.pushedAt || '';
    const pB = globalRepoRegistry[keyB]?.pushedAt || '';
    return new Date(pB).getTime() - new Date(pA).getTime();
  });

  // Limit pathMatches to standard amount
  const slicedPathMatches = pathMatches.slice(0, 50);

  const tookMs = Date.now() - startTime;
  return {
    results: sortedResults,
    pathMatches: slicedPathMatches,
    totalFound,
    truncated: isTruncated,
    tookMs,
    apiCallsUsed: 0
  };
}
