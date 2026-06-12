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
  status: 'queued' | 'checking' | 'downloading' | 'extracting' | 'indexed' | 'failed' | 'skipped-empty' | 'up-to-date' | 'unknown';
  stale: boolean;
  size?: number;
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
  lineNumber: number;
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
    headers: { 'Content-Type': 'application/json' },
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

export interface SearchParams {
  q: string;
  mode: 'mirror' | 'live';
  regex: boolean;
  word: boolean;
  caseSensitive: boolean;
  fold: boolean;
  accounts?: string[];
  repos?: string[];
  path?: string;
  ext?: string;
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

  const res = await fetch(`/api/search?${urlParams.toString()}`);
  if (!res.ok) {
    const errPayload = await res.json();
    throw new Error(errPayload.error || 'Search failed');
  }
  return res.json();
}
