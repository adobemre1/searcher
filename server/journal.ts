import fs from 'fs';
import { appendFile, readFile, rename, stat, truncate, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { CACHE_DIR, JOURNAL_DIR, JOURNAL_ENABLED } from './config.js';
import { foldTurkish } from './fold.js';
import { maskSecrets } from './mask.js';

// ---------------------------------------------------------------------------
// Search Journal — the "found-words notebook".
//
// Design rules (why this file looks the way it does):
//  * Committed searches only — the frontend decides what counts as committed
//    (Enter or a settled query) and calls POST /api/journal/record explicitly.
//    Journaling therefore NEVER sits in the search hot path.
//  * Secret-free by construction: queries that the masker would alter are not
//    persisted at all (masked-at-rest would break click-to-rerun); fragments
//    are never stored.
//  * One serialized writer chain for ALL journal IO — append, last-line
//    rewrite (coalescing), rotation, clear and migration cannot interleave.
//  * journal.jsonl is the detailed trail (rotated at 5 MB); words.json is the
//    durable aggregate that survives rotation.
//  * A circuit breaker (5 consecutive write failures, e.g. ENOSPC) disables
//    journaling without ever affecting search responses.
//
// Budget math: ~300 bytes/entry → 10,000 searches ≈ 3 MB; rotation bounds
// any single file at 5 MB.
// ---------------------------------------------------------------------------

export interface JournalFlags {
  regex: boolean;
  word: boolean;
  caseSensitive: boolean;
  fold: boolean;
}

export interface JournalFilters {
  accounts?: string[];
  repos?: string[];
  path?: string;
  ext?: string;
}

export interface JournalEntry {
  id: string;
  ts: string;
  q: string;
  qFolded: string;
  mode: 'mirror' | 'live' | 'semantic';
  flags: JournalFlags;
  filters: JournalFilters;
  totalFound: number;
  found: boolean;
  tookMs: number;
  apiCallsUsed: number;
  repeats: number;
}

export interface WordAggregate {
  word: string;
  searchCount: number;
  firstSearchedAt: string;
  lastSearchedAt: string;
  lastTotalFound: number;
  everFound: boolean;
}

export interface JournalHealth {
  enabled: boolean;
  breakerTripped: boolean;
  entryCount: number;
  wordCount: number;
  redactedCount: number;
}

const JOURNAL_FILE = path.join(JOURNAL_DIR, 'journal.jsonl');
const WORDS_FILE = path.join(JOURNAL_DIR, 'words.json');
const LEGACY_HISTORY_FILE = path.join(CACHE_DIR, 'search_history.json');
const ROTATE_BYTES = 5 * 1024 * 1024;
const RECENT_CAP = 500;

let words: Record<string, WordAggregate> = {};
let redactedCount = 0;
let recentEntries: JournalEntry[] = []; // newest first
let entryCount = 0;
let lastEntry: JournalEntry | null = null;
let lastLineStart = 0; // byte offset of the last line in journal.jsonl

let consecutiveFailures = 0;
let breakerTripped = false;
let idCounter = 0;

// Single serialized writer chain
let chain: Promise<void> = Promise.resolve();

function enqueue(fn: () => Promise<void>): void {
  chain = chain
    .then(fn)
    .then(() => {
      consecutiveFailures = 0;
    })
    .catch(err => {
      consecutiveFailures++;
      console.error(`[Journal] write failure ${consecutiveFailures}/5:`, err?.message || err);
      if (consecutiveFailures >= 5 && !breakerTripped) {
        breakerTripped = true;
        console.error('[Journal] circuit breaker tripped — journaling disabled (search unaffected).');
      }
    });
}

function newId(): string {
  return `${Date.now().toString(36)}-${(++idCounter).toString(36)}`;
}

function journalingActive(): boolean {
  return JOURNAL_ENABLED && !breakerTripped;
}

function ensureDir() {
  if (!fs.existsSync(JOURNAL_DIR)) {
    fs.mkdirSync(JOURNAL_DIR, { recursive: true });
  }
}

async function persistWords(): Promise<void> {
  await writeFile(WORDS_FILE, JSON.stringify({ words, redactedCount }), 'utf8');
}

function applyWordAggregate(entry: JournalEntry) {
  const existing = words[entry.qFolded];
  if (existing) {
    existing.searchCount++;
    existing.lastSearchedAt = entry.ts;
    existing.lastTotalFound = entry.totalFound;
    existing.everFound = existing.everFound || entry.found;
    existing.word = entry.q;
  } else {
    words[entry.qFolded] = {
      word: entry.q,
      searchCount: 1,
      firstSearchedAt: entry.ts,
      lastSearchedAt: entry.ts,
      lastTotalFound: entry.totalFound,
      everFound: entry.found
    };
  }
}

async function rotateIfNeeded(): Promise<void> {
  try {
    const st = await stat(JOURNAL_FILE);
    if (st.size > ROTATE_BYTES) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await rename(JOURNAL_FILE, path.join(JOURNAL_DIR, `journal-${stamp}.jsonl`));
      lastEntry = null;
      lastLineStart = 0;
    }
  } catch {
    // file does not exist yet — nothing to rotate
  }
}

async function appendEntry(entry: JournalEntry): Promise<void> {
  ensureDir();
  await rotateIfNeeded();
  let sizeBefore = 0;
  try {
    sizeBefore = (await stat(JOURNAL_FILE)).size;
  } catch {
    sizeBefore = 0;
  }
  await appendFile(JOURNAL_FILE, JSON.stringify(entry) + '\n', 'utf8');
  lastLineStart = sizeBefore;
  lastEntry = entry;
  entryCount++;
  recentEntries.unshift(entry);
  if (recentEntries.length > RECENT_CAP) recentEntries.length = RECENT_CAP;
  applyWordAggregate(entry);
  await persistWords();
}

async function rewriteLastEntry(entry: JournalEntry): Promise<void> {
  // Coalescing rewrites only the final line: truncate to its start, re-append.
  await truncate(JOURNAL_FILE, lastLineStart);
  await appendFile(JOURNAL_FILE, JSON.stringify(entry) + '\n', 'utf8');
  lastEntry = entry;
  if (recentEntries.length > 0) recentEntries[0] = entry;
  // The repeat still counts as a search in the aggregate (AC-30).
  applyWordAggregate(entry);
  await persistWords();
}

function coalesceKey(qFolded: string, mode: string, flags: JournalFlags): string {
  return `${qFolded}|${mode}|${flags.regex ? 1 : 0}${flags.word ? 1 : 0}${flags.caseSensitive ? 1 : 0}${flags.fold ? 1 : 0}`;
}

// ---------------------------------------------------------------------------
// Boot: load words, seed coalesce state from the journal tail, migrate legacy.
// ---------------------------------------------------------------------------
export function initJournal(): void {
  ensureDir();

  // words.json (corrupt → archive, never overwrite the only copy)
  if (fs.existsSync(WORDS_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(WORDS_FILE, 'utf8'));
      words = parsed.words || {};
      redactedCount = parsed.redactedCount || 0;
    } catch {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      try {
        fs.renameSync(WORDS_FILE, `${WORDS_FILE}.corrupt-${stamp}`);
      } catch {}
      words = {};
      redactedCount = 0;
    }
  }

  // Seed lastEntry + recentEntries from the existing journal tail so a restart
  // neither duplicates coalesced entries nor forgets recent history.
  if (fs.existsSync(JOURNAL_FILE)) {
    try {
      const raw = fs.readFileSync(JOURNAL_FILE, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      entryCount = lines.length;
      const tail = lines.slice(-RECENT_CAP);
      const parsedTail: JournalEntry[] = [];
      for (const line of tail) {
        try {
          parsedTail.push(JSON.parse(line));
        } catch {}
      }
      recentEntries = parsedTail.reverse();
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        try {
          lastEntry = JSON.parse(lastLine);
          lastLineStart = Buffer.byteLength(raw) - Buffer.byteLength(lastLine + '\n');
        } catch {
          lastEntry = null;
          lastLineStart = Buffer.byteLength(raw);
        }
      }
    } catch (err) {
      console.error('[Journal] failed to read journal tail:', err);
    }
  }

  migrateLegacyHistory();
}

/**
 * One-time, idempotent import of the old .cache/search_history.json:
 *  * masked-on-import — entries whose query the masker would alter are counted
 *    as redacted and skipped (they are already on disk unmasked; the rename
 *    below takes the plaintext file out of active use),
 *  * original timestamps preserved, IDs re-keyed, no retroactive coalescing,
 *  * the rename to .migrated is the idempotency marker.
 */
function migrateLegacyHistory(): void {
  if (!fs.existsSync(LEGACY_HISTORY_FILE)) return;
  if (fs.existsSync(`${LEGACY_HISTORY_FILE}.migrated`)) return;

  enqueue(async () => {
    let legacy: any[] = [];
    try {
      legacy = JSON.parse(await readFile(LEGACY_HISTORY_FILE, 'utf8'));
    } catch {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await rename(LEGACY_HISTORY_FILE, `${LEGACY_HISTORY_FILE}.corrupt-${stamp}`).catch(() => {});
      console.error('[Journal] legacy history was corrupt — archived, migration skipped.');
      return;
    }

    if (!Array.isArray(legacy)) legacy = [];
    let imported = 0;
    let redacted = 0;

    // Legacy stored newest-first; import oldest-first to keep order.
    for (const item of [...legacy].reverse()) {
      const q = String(item?.q ?? '').trim();
      if (q.length < 3) continue;
      if (maskSecrets(q) !== q) {
        redacted++;
        continue;
      }
      const entry: JournalEntry = {
        id: newId(),
        ts: item.timestamp || new Date().toISOString(),
        q,
        qFolded: foldTurkish(q),
        mode: item.mode === 'live' || item.mode === 'semantic' ? item.mode : 'mirror',
        flags: {
          regex: !!item.regex,
          word: !!item.word,
          caseSensitive: !!item.caseSensitive,
          fold: item.fold !== false
        },
        filters: {
          accounts: item.accounts,
          repos: item.repos,
          path: item.path,
          ext: item.ext
        },
        totalFound: Number(item.totalFound) || 0,
        found: (Number(item.totalFound) || 0) > 0,
        tookMs: Number(item.tookMs) || 0,
        apiCallsUsed: item.mode === 'live' ? 1 : 0,
        repeats: 1
      };
      await appendEntry(entry);
      imported++;
    }

    redactedCount += redacted;
    await persistWords();
    await rename(LEGACY_HISTORY_FILE, `${LEGACY_HISTORY_FILE}.migrated`);
    console.log(`[Journal] migrated ${imported} legacy entries (${redacted} redacted, kept out).`);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RecordInput {
  q: string;
  mode: 'mirror' | 'live' | 'semantic';
  flags: JournalFlags;
  filters: JournalFilters;
  totalFound: number;
  tookMs: number;
  apiCallsUsed: number;
}

export interface RecordOutcome {
  recorded: boolean;
  redacted?: boolean;
  coalesced?: boolean;
  reason?: string;
}

export function recordSearch(input: RecordInput): RecordOutcome {
  if (!journalingActive()) {
    return { recorded: false, reason: breakerTripped ? 'breaker' : 'disabled' };
  }

  const q = (input.q || '').trim();
  if (q.length < 3) {
    return { recorded: false, reason: 'too-short' };
  }

  // Secret queries are never persisted (this is a secret-hunting tool —
  // pasted suspicious strings must not land on disk).
  if (maskSecrets(q) !== q) {
    redactedCount++;
    enqueue(async () => {
      ensureDir();
      await persistWords();
    });
    return { recorded: false, redacted: true };
  }

  const qFolded = foldTurkish(q);
  const key = coalesceKey(qFolded, input.mode, input.flags);
  const now = new Date().toISOString();

  if (lastEntry && coalesceKey(lastEntry.qFolded, lastEntry.mode, lastEntry.flags) === key) {
    const updated: JournalEntry = {
      ...lastEntry,
      ts: now,
      totalFound: input.totalFound,
      found: input.totalFound > 0,
      tookMs: input.tookMs,
      apiCallsUsed: input.apiCallsUsed,
      repeats: lastEntry.repeats + 1
    };
    lastEntry = updated; // optimistic: keeps coalescing consistent pre-flush
    enqueue(() => rewriteLastEntry(updated));
    return { recorded: true, coalesced: true };
  }

  const entry: JournalEntry = {
    id: newId(),
    ts: now,
    q,
    qFolded,
    mode: input.mode,
    flags: input.flags,
    filters: input.filters,
    totalFound: input.totalFound,
    found: input.totalFound > 0,
    tookMs: input.tookMs,
    apiCallsUsed: input.apiCallsUsed,
    repeats: 1
  };
  lastEntry = entry;
  enqueue(() => appendEntry(entry));
  return { recorded: true };
}

export function getRecentEntries(limit = 200): JournalEntry[] {
  return recentEntries.slice(0, Math.max(1, Math.min(limit, RECENT_CAP)));
}

export function getWordAggregates(): WordAggregate[] {
  return Object.values(words).sort(
    (a, b) => new Date(b.lastSearchedAt).getTime() - new Date(a.lastSearchedAt).getTime()
  );
}

export function getJournalHealth(): JournalHealth {
  return {
    enabled: JOURNAL_ENABLED,
    breakerTripped,
    entryCount,
    wordCount: Object.keys(words).length,
    redactedCount
  };
}

export interface JournalAverages {
  mirrorAvgMs: number;
  semanticAvgMs: number;
  liveAvgMs: number;
  totalSearches: number;
}

export function getAverages(): JournalAverages {
  const byMode = (mode: JournalEntry['mode']) => recentEntries.filter(e => e.mode === mode);
  const avg = (entries: JournalEntry[]) =>
    entries.length > 0
      ? parseFloat((entries.reduce((s, e) => s + e.tookMs, 0) / entries.length).toFixed(2))
      : 0;
  return {
    mirrorAvgMs: avg(byMode('mirror')),
    semanticAvgMs: avg(byMode('semantic')),
    liveAvgMs: avg(byMode('live')),
    totalSearches: entryCount
  };
}

export function clearJournal(): Promise<void> {
  return new Promise((resolve) => {
    enqueue(async () => {
      words = {};
      redactedCount = 0;
      recentEntries = [];
      entryCount = 0;
      lastEntry = null;
      lastLineStart = 0;
      await unlink(JOURNAL_FILE).catch(() => {});
      await persistWords();
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// Export — md | json. Empty journal exports a valid "empty notebook" document.
// ---------------------------------------------------------------------------

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/`/g, '\\`');
}

export async function buildExport(format: 'md' | 'json'): Promise<{ contentType: string; filename: string; body: string }> {
  let allEntries: JournalEntry[] = [];
  try {
    const raw = await readFile(JOURNAL_FILE, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        allEntries.push(JSON.parse(line));
      } catch {}
    }
  } catch {
    allEntries = [];
  }
  const wordList = getWordAggregates();

  if (format === 'json') {
    return {
      contentType: 'application/json',
      filename: 'ecysearch_notebook.json',
      body: JSON.stringify({ words: wordList, entries: allEntries, redactedCount }, null, 2)
    };
  }

  const lines: string[] = [];
  lines.push('# Found-Words Notebook — ecysearch');
  lines.push('');
  lines.push(`Exported: ${new Date().toISOString()} · ${wordList.length} word(s) · ${allEntries.length} journal entrie(s) · ${redactedCount} redacted search(es) not stored`);
  lines.push('');
  if (wordList.length === 0) {
    lines.push('_Empty notebook — run some committed searches first (press Enter)._');
  } else {
    lines.push('## Words');
    lines.push('');
    lines.push('| word | searches | found? | first seen | last seen | last hits |');
    lines.push('|---|---|---|---|---|---|');
    for (const w of wordList) {
      lines.push(`| ${escapeMd(w.word)} | ${w.searchCount} | ${w.everFound ? 'yes' : 'no'} | ${w.firstSearchedAt.slice(0, 16)} | ${w.lastSearchedAt.slice(0, 16)} | ${w.lastTotalFound} |`);
    }
    lines.push('');
    lines.push('## Recent history');
    lines.push('');
    lines.push('| time | query | mode | hits | repeats |');
    lines.push('|---|---|---|---|---|');
    for (const e of allEntries.slice(-100).reverse()) {
      lines.push(`| ${e.ts.slice(0, 16)} | ${escapeMd(e.q)} | ${e.mode} | ${e.totalFound} | ${e.repeats} |`);
    }
  }
  lines.push('');

  return {
    contentType: 'text/markdown',
    filename: 'ecysearch_notebook.md',
    body: lines.join('\n')
  };
}
