import { githubFetch, getTokenForAccount, logSafe } from './github.js';
import { maskSecrets } from './mask.ts';
import { SearchResponse, SearchResult } from './searchIndex.ts';

// 1. Sleek, high-performance in-memory LRU Cache
class SimpleLRU<K, V> {
  private cache = new Map<K, { value: V; expiresAt: number }>();
  constructor(private maxEntries = 50, private ttlMs = 5 * 60 * 1000) {}

  get(key: K): V | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // Move to end (fresh item order)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      // Evict oldest (which is the first element in map iteration)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

const liveSearchCache = new SimpleLRU<string, SearchResponse>();

// 2. High-precision anti-burst single-flight ticketing queue per account
class TicketQueue {
  private lastExecuted = 0;
  private queue: (() => void)[] = [];
  private isProcessing = false;

  constructor(private spacingMs = 6500) {}

  enqueue(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.process();
    });
  }

  // Freeze the queue temporarily when hit with secondary rate limits (Retry-After)
  freeze(durationMs: number) {
    logSafe(`Freezing live search token queue for ${durationMs / 1000} seconds due to GitHub rate-limit instructions.`);
    this.lastExecuted = Date.now() + durationMs;
  }

  private async process() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const elapsed = now - this.lastExecuted;
      const wait = this.spacingMs - elapsed;

      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }

      const nextResolve = this.queue.shift();
      if (nextResolve) {
        nextResolve();
        this.lastExecuted = Date.now();
      }
    }

    this.isProcessing = false;
  }
}

// Map account login to a dedicated spacing queue
const queues: Record<string, TicketQueue> = {};

function getQueueForAccount(login: string): TicketQueue {
  if (!queues[login]) {
    queues[login] = new TicketQueue();
  }
  return queues[login];
}

/**
 * Searches live GitHub code search API following strict rate bounds.
 */
export async function searchLiveOnGitHub(params: {
  q: string;
  accounts?: string[];
  repos?: string[];
  limit?: number;
}): Promise<SearchResponse & { retryAfterSec?: number }> {
  const startTime = Date.now();
  const rawQuery = params.q;
  const limit = params.limit || 50;

  if (!rawQuery) {
    return { results: [], pathMatches: [], totalFound: 0, truncated: false, tookMs: 0, apiCallsUsed: 0 };
  }

  // 1. Key calculations for LRU Cache
  const cacheKey = JSON.stringify({ q: rawQuery, accounts: params.accounts, repos: params.repos });
  const cachedMatch = liveSearchCache.get(cacheKey);
  if (cachedMatch) {
    logSafe(`Cache hit for search query: "${rawQuery}"`);
    return { ...cachedMatch, tookMs: Date.now() - startTime }; // Instant response
  }

  // 2. Decide login context with preferred token
  let activeLogin = 'eCy-coding';
  if (params.accounts && params.accounts.length > 0) {
    activeLogin = params.accounts[0];
  } else {
    // Find first account with token as fallback
    const authedAccount = ['eCy-coding', 'adobemre1'].find(login => getTokenForAccount(login) !== null);
    if (authedAccount) {
      activeLogin = authedAccount;
    }
  }

  // Enforce zero-token fallback limit check
  const hasToken = getTokenForAccount(activeLogin) !== null;
  if (!hasToken) {
    throw new Error(`Live mode requires an authenticated GitHub PAT inside .env.local for high rate limits.`);
  }

  // 3. Sequential Queue Ticketing per account
  const queue = getQueueForAccount(activeLogin);
  await queue.enqueue();

  // 4. Query compilation including scopes
  // Schema: /search/code?q=term user:eCy-coding user:adobemre1 repofilters...
  let codeQuery = `${rawQuery}`;
  
  if (params.repos && params.repos.length > 0) {
    for (const repoName of params.repos) {
      codeQuery += ` repo:${repoName}`;
    }
  } else {
    const scopeAccounts = params.accounts && params.accounts.length > 0 ? params.accounts : ['eCy-coding', 'adobemre1'];
    for (const acc of scopeAccounts) {
      codeQuery += ` user:${acc}`;
    }
  }

  const encodedQuery = encodeURIComponent(codeQuery);
  const searchUrl = `/search/code?q=${encodedQuery}&per_page=${limit}`;

  try {
    // Add text match vendor headers to return precise match offsets
    const customHeaders = {
      'Accept': 'application/vnd.github.text-match+json'
    };

    const res = await githubFetch(activeLogin, searchUrl, {
      useETag: false,
      customHeaders
    });

    if (res.status === 403 || res.status === 429) {
      const retryHeader = res.headers.get('Retry-After');
      const resetHeader = res.headers.get('x-ratelimit-reset');
      let waitSeconds = 60; // Safe default limit freeze

      if (retryHeader) {
        waitSeconds = parseInt(retryHeader, 10);
      } else if (resetHeader) {
        const resetEpoch = parseInt(resetHeader, 10);
        waitSeconds = Math.max(resetEpoch - Math.floor(Date.now() / 1000), 1);
      }

      queue.freeze(waitSeconds * 1000);
      return {
        results: [],
        pathMatches: [],
        totalFound: 0,
        truncated: false,
        tookMs: Date.now() - startTime,
        apiCallsUsed: 1,
        retryAfterSec: waitSeconds
      };
    }

    if (res.status === 401) {
      throw new Error(`PAT Authentication invalid (401) on real-time live search.`);
    }

    if (res.status !== 200) {
      throw new Error(`GitHub search API returned error status ${res.status}.`);
    }

    // Parse matching files and line fragments
    const results: SearchResult[] = [];
    const payload = res.body;

    if (payload && Array.isArray(payload.items)) {
      for (const item of payload.items) {
        const owner = item.repository?.owner?.login || activeLogin;
        const repo = item.repository?.name || '';
        const path = item.path || '';

        // Safely extract text matches if returned by Github matching vendor API
        if (Array.isArray(item.text_matches)) {
          for (const match of item.text_matches) {
            const fragment = match.fragment || '';
            
            // Map index positions returned by GitHub API
            const matchRanges = Array.isArray(match.matches)
              ? match.matches.map((m: any) => ({
                  start: m.indices[0],
                  length: m.indices[1] - m.indices[0]
                }))
              : [];

            results.push({
              owner,
              repo,
              path,
              line: maskSecrets(fragment),
              lineNumber: 1, // Line is approximate in github live search, default to 1
              before: null,
              after: null,
              matchRanges
            });
          }
        } else {
          // If no specific text highlights are returned, send fallback listing hit
          results.push({
            owner,
            repo,
            path,
            line: `${path} matched query`,
            lineNumber: 1,
            before: null,
            after: null,
            matchRanges: [{ start: 0, length: path.length }]
          });
        }
      }
    }

    const pathMatches = results.map(r => ({ owner: r.owner, repo: r.repo, path: r.path })).slice(0, 10);
    const response: SearchResponse = {
      results,
      pathMatches,
      totalFound: payload?.total_count || results.length,
      truncated: results.length < (payload?.total_count || 0),
      tookMs: Date.now() - startTime,
      apiCallsUsed: 1
    };

    // Store in LRU cache
    liveSearchCache.set(cacheKey, response);

    return response;

  } catch (error: any) {
    logSafe(`Real-time Search operation failed: ${error?.message}`);
    throw error;
  }
}
