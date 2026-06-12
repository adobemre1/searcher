export interface AccountInfo {
  login: string;
  hasToken: boolean;
  verifiedLogin: string;
  public_repos: number;
  verified: boolean;
}

export interface RepoInfo {
  id: string;
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string;
  sha?: string;
  syncedAt?: string;
  fileCount?: number;
  lineCount?: number;
  skipped?: {
    excluded: number;
    binary: number;
    oversize: number;
    budget: number;
    empty: number;
  } | null;
  status: 'queued' | 'checking' | 'downloading' | 'extracting' | 'indexed' | 'failed' | 'skipped-empty' | 'skipped-demo' | 'deferred' | 'up-to-date' | 'unknown';
  stale: boolean;
  size?: number;
  repoSizeKb?: number;
}

export interface SyncProgressItem {
  name: string;
  owner: string;
  isPrivate: boolean;
  status: RepoInfo['status'];
  fileCount: number;
  lineCount: number;
  skipped: any;
  error?: string;
  sha?: string;
  syncedAt?: string;
}

export interface SyncStatus {
  active: boolean;
  totalRepos: number;
  completedRepos: number;
  currentRepo: string;
  repos: Record<string, SyncProgressItem>;
  startedAt: string | null;
  errorMessage: string | null;
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
  // null = fragment without a known line number (live mode); links omit #L
  lineNumber: number | null;
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
  retryAfterSec?: number;
}

export interface RateLimitState {
  limit: number;
  remaining: number;
  reset: number;
}

export interface RateLimits {
  [login: string]: {
    core: RateLimitState;
    search: RateLimitState | null;
  } | null;
}

export interface DoctorDiagnostic {
  title: string;
  status: 'pass' | 'fail';
  message: string;
}

export interface DoctorResponse {
  ok: boolean;
  diagnostics: DoctorDiagnostic[];
}

// Mutating endpoints require this header: cross-origin pages cannot set
// custom headers, which blocks drive-by (CSRF) requests against localhost.
const INTENT_HEADERS = { 'X-Ecysearch': '1', 'Content-Type': 'application/json' };

export async function getHealth(): Promise<{ ok: boolean; version: string; mode: string }> {
  const res = await fetch('/api/health');
  return res.json();
}

export async function getAccounts(): Promise<AccountInfo[]> {
  const res = await fetch('/api/accounts');
  return res.json();
}

export async function getRepos(): Promise<RepoInfo[]> {
  const res = await fetch('/api/repos');
  return res.json();
}

export async function triggerSync(force = false): Promise<{ ok: boolean; message: string }> {
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: INTENT_HEADERS,
    body: JSON.stringify({ force })
  });
  if (!res.ok) {
    const errPayload = await res.json();
    throw new Error(errPayload.error || 'Failed to start sync');
  }
  return res.json();
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const res = await fetch('/api/sync/status');
  return res.json();
}

export async function getRateLimits(): Promise<RateLimits> {
  const res = await fetch('/api/ratelimit');
  return res.json();
}

export async function getDoctor(): Promise<DoctorResponse> {
  const res = await fetch('/api/doctor');
  return res.json();
}

export async function deleteRepoCache(id: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch('/api/repos/delete', {
    method: 'POST',
    headers: INTENT_HEADERS,
    body: JSON.stringify({ id })
  });
  if (!res.ok) {
    const errorPayload = await res.json();
    throw new Error(errorPayload.error || 'Failed to purge repository index');
  }
  return res.json();
}

export interface SearchParams {
  q: string;
  mode: 'mirror' | 'live' | 'semantic';
  regex: boolean;
  word: boolean;
  caseSensitive: boolean;
  fold: boolean;
  accounts?: string[];
  repos?: string[];
  path?: string;
  ext?: string;
  similarityThreshold?: number;
  pathBoost?: number;
  k1?: number;
  b?: number;
  maxLineLength?: number;
}

export async function search(params: SearchParams): Promise<SearchResponse> {
  const urlParams = new URLSearchParams();
  urlParams.set('q', params.q);
  urlParams.set('mode', params.mode);
  urlParams.set('regex', String(params.regex));
  urlParams.set('word', String(params.word));
  urlParams.set('caseSensitive', String(params.caseSensitive));
  urlParams.set('fold', String(params.fold));

  if (params.accounts && params.accounts.length > 0) {
    urlParams.set('accounts', params.accounts.join(','));
  }
  if (params.repos && params.repos.length > 0) {
    urlParams.set('repos', params.repos.join(','));
  }
  if (params.path) {
    urlParams.set('path', params.path);
  }
  if (params.ext) {
    urlParams.set('ext', params.ext);
  }
  if (params.similarityThreshold !== undefined) {
    urlParams.set('similarityThreshold', String(params.similarityThreshold));
  }
  if (params.pathBoost !== undefined) {
    urlParams.set('pathBoost', String(params.pathBoost));
  }
  if (params.k1 !== undefined) {
    urlParams.set('k1', String(params.k1));
  }
  if (params.b !== undefined) {
    urlParams.set('b', String(params.b));
  }
  if (params.maxLineLength !== undefined) {
    urlParams.set('maxLineLength', String(params.maxLineLength));
  }

  const res = await fetch(`/api/search?${urlParams.toString()}`);
  if (!res.ok) {
    const errPayload = await res.json();
    throw new Error(errPayload.error || 'Search failed');
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Journal — the found-words notebook
// ---------------------------------------------------------------------------

export interface JournalFlags {
  regex: boolean;
  word: boolean;
  caseSensitive: boolean;
  fold: boolean;
}

export interface JournalEntry {
  id: string;
  ts: string;
  q: string;
  qFolded: string;
  mode: 'mirror' | 'live' | 'semantic';
  flags: JournalFlags;
  filters: {
    accounts?: string[];
    repos?: string[];
    path?: string;
    ext?: string;
  };
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

export interface JournalRecordOutcome {
  recorded: boolean;
  redacted?: boolean;
  coalesced?: boolean;
  reason?: string;
}

export async function recordJournal(input: {
  q: string;
  mode: 'mirror' | 'live' | 'semantic';
  flags: JournalFlags;
  filters: { accounts?: string[]; repos?: string[]; path?: string; ext?: string };
  totalFound: number;
  tookMs: number;
  apiCallsUsed: number;
}): Promise<JournalRecordOutcome> {
  const res = await fetch('/api/journal/record', {
    method: 'POST',
    headers: INTENT_HEADERS,
    body: JSON.stringify(input)
  });
  return res.json();
}

export async function getJournalEntries(limit = 200): Promise<JournalEntry[]> {
  const res = await fetch(`/api/journal?limit=${limit}`);
  return res.json();
}

export async function getJournalWords(): Promise<WordAggregate[]> {
  const res = await fetch('/api/journal/words');
  return res.json();
}

export async function clearJournal(): Promise<{ ok: boolean; message: string }> {
  const res = await fetch('/api/journal', {
    method: 'DELETE',
    headers: INTENT_HEADERS
  });
  return res.json();
}

export function journalExportUrl(format: 'md' | 'json'): string {
  return `/api/journal/export?format=${format}`;
}

// ---------------------------------------------------------------------------
// System metrics — measured values only
// ---------------------------------------------------------------------------

export interface SystemMetrics {
  cpu: {
    cores: number;
    model: string;
    loadavg: number[];
  };
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
  };
  index: {
    repos: number;
    files: number;
    lines: number;
    shardBytes: number;
  };
  search: {
    mirrorAvgMs: number;
    semanticAvgMs: number;
    liveAvgMs: number;
    totalSearches: number;
  };
  journal: {
    enabled: boolean;
    breakerTripped: boolean;
    entryCount: number;
    wordCount: number;
    redactedCount: number;
  };
  process: {
    node: string;
    platform: string;
    uptimeSec: number;
  };
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  const res = await fetch('/api/system');
  return res.json();
}
