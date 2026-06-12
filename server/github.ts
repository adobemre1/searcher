import fs from 'fs';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { ETAGS_FILE, ACCOUNTS } from './config.js';

// ---------------------------------------------------------------------------
// ETag store: loaded once, mutated in memory, flushed debounced. The previous
// implementation re-read and re-wrote the JSON file on every save, which raced
// against the 2-way concurrent sync workers.
// ---------------------------------------------------------------------------
let etags: Record<string, string> = {};
let etagsLoaded = false;
let flushTimer: NodeJS.Timeout | null = null;

function ensureCacheDir() {
  const dir = path.dirname(ETAGS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadETagsOnce() {
  if (etagsLoaded) return;
  etagsLoaded = true;
  ensureCacheDir();
  if (fs.existsSync(ETAGS_FILE)) {
    try {
      etags = JSON.parse(fs.readFileSync(ETAGS_FILE, 'utf-8'));
    } catch {
      etags = {};
    }
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushETags();
  }, 500);
}

function flushETags() {
  try {
    ensureCacheDir();
    fs.writeFileSync(ETAGS_FILE, JSON.stringify(etags), 'utf-8');
  } catch (err) {
    console.error('Failed to write ETags file:', err);
  }
}

process.on('exit', () => {
  if (flushTimer) flushETags();
});

function saveETag(url: string, etag: string | null) {
  if (!etag) return;
  loadETagsOnce();
  etags[url] = etag;
  scheduleFlush();
}

export function getETag(url: string): string | null {
  loadETagsOnce();
  return etags[url] || null;
}

export function clearETags() {
  loadETagsOnce();
  etags = {};
  if (fs.existsSync(ETAGS_FILE)) {
    try {
      fs.unlinkSync(ETAGS_FILE);
    } catch {}
  }
}

// ---------------------------------------------------------------------------

export interface RateLimitState {
  limit: number;
  remaining: number;
  reset: number; // epoch seconds
}

export interface AccountTokenState {
  login: string;
  hasToken: boolean;
  tokenValid: boolean;
  rateLimits: {
    core: RateLimitState;
    search: RateLimitState | null;
  } | null;
}

// Get access token for login from process.env
export function getTokenForAccount(login: string): string | null {
  const account = ACCOUNTS.find(a => a.login === login);
  if (!account) return null;
  const token = process.env[account.tokenEnv];
  return token ? token.trim() : null;
}

// Safe headers generator that never exposes token in print/logs
export function getGitHubHeaders(login: string, customHeaders: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'ecysearch',
    'X-GitHub-Api-Version': '2022-11-28',
    'Accept': 'application/vnd.github+json',
    ...customHeaders
  };

  const token = getTokenForAccount(login);
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// Safe console logger that masks any token shape that could end up in a message
export function logSafe(msg: string) {
  let safeMsg = msg;
  safeMsg = safeMsg.replace(/gh[pousr]_[A-Za-z0-9]{36,}/g, 'gh•_••••••••');
  safeMsg = safeMsg.replace(/github_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_••••');
  console.log(`[GitHubClient] ${safeMsg}`);
}

/**
 * Parses a Retry-After header that may be either delta-seconds or an HTTP-date
 * (both are legal per RFC 9110). Returns a bounded wait in milliseconds.
 * NaN from date-form headers previously produced a zero-wait hot retry loop.
 */
export function parseRetryAfterMs(retryAfter: string | null, rateLimitReset: string | null): number | null {
  if (retryAfter) {
    const asSeconds = Number(retryAfter);
    if (Number.isFinite(asSeconds)) {
      return Math.max(1000, asSeconds * 1000);
    }
    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate)) {
      return Math.max(1000, asDate - Date.now());
    }
    return 1000;
  }
  if (rateLimitReset) {
    const resetEpoch = parseInt(rateLimitReset, 10);
    if (Number.isFinite(resetEpoch)) {
      return Math.max(1000, resetEpoch * 1000 - Date.now());
    }
  }
  return null;
}

// In-request waits are capped: a long secondary limit must not hang a request
// for hours. Longer waits are surfaced to the caller as a structured 429.
const MAX_INREQUEST_WAIT_MS = 60_000;

export interface GitHubFetchResult {
  status: number;
  body: any;
  headers: Headers;
  fromETag: boolean;
  retryAfterSec?: number;
}

/**
 * Executes a GitHub API request with ETag caching, bounded Retry-After
 * discipline, pagination-friendly raw headers and 5xx retries.
 */
export async function githubFetch(
  login: string,
  urlPath: string,
  options: {
    method?: string;
    customHeaders?: Record<string, string>;
    body?: any;
    useETag?: boolean;
    ignoreErrors?: boolean;
  } = {}
): Promise<GitHubFetchResult> {
  const method = options.method || 'GET';
  const useETag = options.useETag !== false && method === 'GET';
  const url = urlPath.startsWith('http') ? urlPath : `https://api.github.com${urlPath}`;

  const headers = getGitHubHeaders(login, options.customHeaders || {});
  if (useETag) {
    const storedETag = getETag(url);
    if (storedETag) {
      headers['If-None-Match'] = storedETag;
    }
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (options.body) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  let attempts = 0;
  const maxAttempts = 3;
  let backoffMs = 1000;

  while (attempts < maxAttempts) {
    attempts++;
    try {
      const response = await fetch(url, fetchOptions);

      // 401: fail fast, account is flagged by callers
      if (response.status === 401) {
        logSafe(`Unauthorized 401 for account ${login} on ${urlPath}.`);
        return { status: 401, body: null, headers: response.headers, fromETag: false };
      }

      // 403/429: honor Retry-After (both formats), bounded
      if (response.status === 403 || response.status === 429) {
        const waitMs = parseRetryAfterMs(
          response.headers.get('Retry-After'),
          response.headers.get('x-ratelimit-reset')
        );

        if (waitMs !== null && waitMs <= MAX_INREQUEST_WAIT_MS && attempts < maxAttempts) {
          logSafe(`Rate limited (${response.status}) on ${urlPath}. Waiting ${Math.round(waitMs / 1000)}s (bounded).`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }

        // Too long to wait in-request (or out of attempts): structured deferral
        const retryAfterSec = waitMs !== null ? Math.ceil(waitMs / 1000) : 60;
        logSafe(`Rate limited (${response.status}) on ${urlPath}. Deferring ${retryAfterSec}s to caller.`);
        return {
          status: 429,
          body: null,
          headers: response.headers,
          fromETag: false,
          retryAfterSec
        };
      }

      // 5xx: exponential backoff
      if (response.status >= 500) {
        if (attempts < maxAttempts) {
          logSafe(`Server error ${response.status} on ${urlPath}. Retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          backoffMs *= 2;
          continue;
        }
      }

      if (response.status === 200 && useETag) {
        const etagValue = response.headers.get('ETag');
        if (etagValue) {
          saveETag(url, etagValue);
        }
      }

      if (response.status === 304) {
        return { status: 304, body: null, headers: response.headers, fromETag: true };
      }

      let responseBody: any = null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      return {
        status: response.status,
        body: responseBody,
        headers: response.headers,
        fromETag: false
      };
    } catch (error: any) {
      if (attempts >= maxAttempts) {
        logSafe(`Network error calling GitHub API: ${error?.message || error}`);
        throw error;
      }
      logSafe(`Network failed: ${error?.message || error}. Retrying in ${backoffMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffMs));
      backoffMs *= 2;
    }
  }

  throw new Error(`Failed to complete call to ${urlPath} after ${maxAttempts} attempts.`);
}

/**
 * Downloads a repo zipball using the manual redirect dance: Node fetch strips
 * the Authorization header on the cross-origin redirect to codeload.github.com,
 * so we intercept the 302 and follow the pre-signed Location ourselves —
 * without the auth header. The body is streamed to disk with backpressure.
 */
export async function downloadRepoZipball(
  login: string,
  owner: string,
  repo: string,
  ref: string,
  outputPath: string
): Promise<void> {
  const initialUrl = `https://api.github.com/repos/${owner}/${repo}/zipball/${ref}`;
  const headers = getGitHubHeaders(login);

  const initialResponse = await fetch(initialUrl, {
    method: 'GET',
    headers,
    redirect: 'manual'
  });

  if (initialResponse.status === 401) {
    throw new Error(`Unauthorized (401) while requesting zipball for ${owner}/${repo}. Check PAT.`);
  }

  let downloadUrl = '';
  if (initialResponse.status === 302 || initialResponse.status === 301) {
    downloadUrl = initialResponse.headers.get('Location') || '';
  } else if (initialResponse.status === 200) {
    downloadUrl = initialUrl;
  } else {
    throw new Error(`Failed to initiate zipball download (HTTP ${initialResponse.status})`);
  }

  if (!downloadUrl) {
    throw new Error('Zipball redirect Location not returned by api.github.com');
  }

  const parsedUrl = new URL(downloadUrl);
  logSafe(`Zipball redirect target host: ${parsedUrl.hostname} (Authorization header omitted on follow)`);

  const parentDir = path.dirname(outputPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Pre-signed URL: no auth header on purpose
  const fileResponse = await fetch(downloadUrl, { method: 'GET', redirect: 'follow' });

  if (!fileResponse.ok) {
    throw new Error(`HTTP error downloading zipball: ${fileResponse.status} ${fileResponse.statusText}`);
  }
  if (!fileResponse.body) {
    throw new Error('Response body is empty for zip download');
  }

  try {
    await pipeline(
      Readable.fromWeb(fileResponse.body as any),
      createWriteStream(outputPath)
    );
  } catch (err) {
    fs.unlink(outputPath, () => {});
    throw err;
  }
}

/**
 * Paginates and loads all repositories accessible for the account.
 * Authenticated: /user/repos (owner + collaborator, includes private).
 * Unauthenticated fallback: /users/{login}/repos (public only, paginated).
 */
export async function listUserRepositories(login: string): Promise<any[]> {
  const hasToken = getTokenForAccount(login) !== null;
  let repos: any[] = [];
  let page = 1;
  const perPage = 100;
  let hasMore = true;

  while (hasMore) {
    const url = hasToken
      ? `/user/repos?per_page=${perPage}&page=${page}&affiliation=owner,collaborator`
      : `/users/${login}/repos?per_page=${perPage}&page=${page}`;

    const res = await githubFetch(login, url, { useETag: false });

    if (res.status === 401 || res.status === 429) {
      break;
    }

    const pageRepos = res.body;
    if (Array.isArray(pageRepos) && pageRepos.length > 0) {
      repos = repos.concat(pageRepos);
      page++;
    } else {
      hasMore = false;
    }

    const linkHeader = res.headers.get('Link');
    if (!linkHeader || !linkHeader.includes('rel="next"')) {
      hasMore = false;
    }
  }

  repos.sort((a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime());
  return repos;
}

/**
 * Current rate limits (the /rate_limit endpoint itself is always free).
 */
export async function getRateLimits(login: string): Promise<AccountTokenState['rateLimits']> {
  try {
    const res = await githubFetch(login, '/rate_limit', { useETag: false, ignoreErrors: true });
    if (res.status !== 200 || !res.body) return null;

    const core = res.body.resources.core;
    const search = res.body.resources.search || null;

    return {
      core: {
        limit: core.limit,
        remaining: core.remaining,
        reset: core.reset
      },
      search: search ? {
        limit: search.limit,
        remaining: search.remaining,
        reset: search.reset
      } : null
    };
  } catch {
    return null;
  }
}
