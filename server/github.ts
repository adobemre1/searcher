import fs from 'fs';
import path from 'path';
import { ETAGS_FILE, ACCOUNTS } from './config.js';

// Ensure cache directory exists
function ensureCacheDir() {
  const dir = path.dirname(ETAGS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// In-memory or on-disk ETag store
let etags: Record<string, string> = {};

function loadETags() {
  ensureCacheDir();
  if (fs.existsSync(ETAGS_FILE)) {
    try {
      etags = JSON.parse(fs.readFileSync(ETAGS_FILE, 'utf-8'));
    } catch {
      etags = {};
    }
  }
}

function saveETag(url: string, etag: string | null) {
  if (!etag) return;
  loadETags();
  etags[url] = etag;
  try {
    fs.writeFileSync(ETAGS_FILE, JSON.stringify(etags, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write ETags file:', err);
  }
}

export function getETag(url: string): string | null {
  loadETags();
  return etags[url] || null;
}

export function clearETags() {
  etags = {};
  if (fs.existsSync(ETAGS_FILE)) {
    try {
      fs.unlinkSync(ETAGS_FILE);
    } catch {}
  }
}

// Map account login to verified status and rate limit state
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

// Safe console logger that masks any personal access token
export function logSafe(msg: string) {
  let safeMsg = msg;
  // Mask ghp_ and other token structures in logging
  safeMsg = safeMsg.replace(/ghp_[A-Za-z0-9]{36}/g, 'ghp_••••••••••••••••••••••••••••••••');
  safeMsg = safeMsg.replace(/github_pat_[A-Za-z0-9_]{20,}/g, 'github_pat_••••••••••••••••••••');
  console.log(`[GitHubClient] ${safeMsg}`);
}

/**
 * Executes a GitHub API request with ETag checking, pagination tracking, retries, and rate limit discipline.
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
): Promise<{ status: number; body: any; headers: Headers; fromETag: boolean }> {
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
      logSafe(`Fetching ${method} ${url} (attempt ${attempts}/${maxAttempts})`);
      const response = await fetch(url, fetchOptions);

      // Handle 401 specifically
      if (response.status === 401) {
        logSafe(`Unauthorized 401 for account ${login}. Dropping/ignoring token.`);
        return { status: 401, body: null, headers: response.headers, fromETag: false };
      }

      // Handle 403 / 429 Retry-After discipline
      if (response.status === 403 || response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        const rateLimitReset = response.headers.get('x-ratelimit-reset');
        
        if (retryAfter) {
          const waitTimeSec = parseInt(retryAfter, 10);
          logSafe(`Rate limited (403/429) on ${url}. Retry-After instruction says wait ${waitTimeSec} seconds.`);
          await new Promise(resolve => setTimeout(resolve, waitTimeSec * 1000));
          continue; // Retry after waiting
        } else if (rateLimitReset) {
          const resetEpoch = parseInt(rateLimitReset, 10);
          const currentEpoch = Math.floor(Date.now() / 1000);
          const waitTimeSec = Math.max(resetEpoch - currentEpoch, 1);
          
          if (waitTimeSec < 10) { // Keep safety wait short for automated routines
            logSafe(`Rate limit reset in ${waitTimeSec}s. Waiting...`);
            await new Promise(resolve => setTimeout(resolve, waitTimeSec * 1000));
            continue;
          }
        }
      }

      // Handle server-side 5xx errors with exponential backoff
      if (response.status >= 500) {
        if (attempts < maxAttempts) {
          logSafe(`Server error ${response.status}. Retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          backoffMs *= 2;
          continue;
        }
      }

      // Cache ETag if response is 200 OK
      if (response.status === 200 && useETag) {
        const etagValue = response.headers.get('ETag');
        if (etagValue) {
          saveETag(url, etagValue);
        }
      }

      // Handle cache hit 304
      if (response.status === 304) {
        logSafe(`304 Not Modified hit for ${url}`);
        return { status: 304, body: null, headers: response.headers, fromETag: true };
      }

      // Parse JSON payload if possible
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

  throw new Error(`Failed to complete call to ${url} after ${maxAttempts} attempts.`);
}

/**
 * Handles the manual redirect dance (F-2 and HC-3) specified by GitHub CORS and security behaviors.
 * Node native fetch drops Auth header on multi-domain redirect to codeload.github.com
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

  logSafe(`Initiating manual redirect zipball fetch for ${owner}/${repo} on branch/ref ${ref}`);
  
  // 1. Fetch with redirect: 'manual' to intercept 302
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
    // Some proxies/servers might return the file directly
    downloadUrl = initialUrl;
  } else {
    throw new Error(`Failed to initiate zipball file download (HTTP Status: ${initialResponse.status})`);
  }

  if (!downloadUrl) {
    throw new Error(`Zipball redirect Location not returned by api.github.com`);
  }

  const parsedUrl = new URL(downloadUrl);
  logSafe(`Redirected to target host: ${parsedUrl.hostname} (Auth header will be omitted for security rules)`);

  // Ensure output directory exists
  const parentDir = path.dirname(outputPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // 2. Clear authentication token header for codeload.github.com and follow
  const fileResponse = await fetch(downloadUrl, {
    method: 'GET',
    redirect: 'follow'
  });

  if (!fileResponse.ok) {
    throw new Error(`HTTP Error downloading zip file from redirect target: ${fileResponse.status} ${fileResponse.statusText}`);
  }

  // Stream output to zip archive on disk
  if (!fileResponse.body) {
    throw new Error(`Response body is empty for zip download`);
  }

  const fileStream = fs.createWriteStream(outputPath);
  const reader = fileResponse.body.getReader();

  // Pipe internal chunks safely using a reader loop
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    fileStream.write(Buffer.from(value));
  }
  
  fileStream.end();
  
  return new Promise((resolve, reject) => {
    fileStream.on('finish', resolve);
    fileStream.on('error', err => {
      fs.unlink(outputPath, () => {});
      reject(err);
    });
  });
}

/**
 * Paginates and loads all user repositories accessible with the provided token.
 */
export async function listUserRepositories(login: string): Promise<any[]> {
  const hasToken = getTokenForAccount(login) !== null;
  let repos: any[] = [];
  let page = 1;
  const perPage = 100;

  if (hasToken) {
    // Authenticated path retrieves owned + collaborated + private repos
    let hasMore = true;
    while (hasMore) {
      const url = `/user/repos?per_page=${perPage}&page=${page}&affiliation=owner,collaborator`;
      const res = await githubFetch(login, url, { useETag: false });
      
      if (res.status === 401) {
        break;
      }
      
      const pageRepos = res.body;
      if (Array.isArray(pageRepos)) {
        if (pageRepos.length === 0) {
          hasMore = false;
        } else {
          repos = repos.concat(pageRepos);
          page++;
        }
      } else {
        hasMore = false;
      }

      // Check manual pagination link headers
      const linkHeader = res.headers.get('Link');
      if (linkHeader && !linkHeader.includes('rel="next"')) {
        hasMore = false;
      }
    }
  } else {
    // Unauthenticated fallback handles public-only repository listing
    const url = `/users/${login}/repos?per_page=${perPage}&page=${page}`;
    const res = await githubFetch(login, url, { useETag: false });
    if (Array.isArray(res.body)) {
      repos = res.body;
    }
  }

  // Sort repos by pushed_at descending by default
  repos.sort((a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime());
  return repos;
}

/**
 * Gets the current rate limits dynamically from GitHub API (always a free endpoint)
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
