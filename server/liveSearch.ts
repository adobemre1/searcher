import { githubFetch, getTokenForAccount, logSafe } from './github.js';
import { maskSecrets } from './mask.js';
import { ACCOUNTS } from './config.js';
import { SearchResponse, SearchResult } from './searchIndex.js';

// 1. Simple in-memory LRU cache
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
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

const liveSearchCache = new SimpleLRU<string, SearchResponse>();

// 2. Single-flight anti-burst queue per account token (≥6.5s spacing keeps us
//    inside the ~10 req/min code-search budget with margin).
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

  freeze(durationMs: number) {
    logSafe(`Freezing live search queue for ${Math.round(durationMs / 1000)}s per GitHub rate-limit instructions.`);
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

const queues: Record<string, TicketQueue> = {};

function getQueueForAccount(login: string): TicketQueue {
  if (!queues[login]) {
    queues[login] = new TicketQueue();
  }
  return queues[login];
}

const configuredLogins = () => ACCOUNTS.map(a => a.login);

/**
 * Live GitHub code search proxy under strict rate discipline.
 * Note: text-match fragments carry no line numbers — results use
 * lineNumber: null and the UI links without a line anchor.
 */
export async function searchLiveOnGitHub(params: {
  q: string;
  accounts?: string[];
  repos?: string[];
  limit?: number;
  scope?: 'configured' | 'global';
  page?: number;
}): Promise<SearchResponse & { retryAfterSec?: number }> {
  const startTime = Date.now();
  const rawQuery = params.q;
  // GitHub code search caps per_page at 100 and results at 1000 (10 pages).
  const perPage = Math.min(params.limit || 50, 100);
  const page = Math.max(1, Math.min(params.page || 1, 10));
  const scope = params.scope || 'configured';

  if (!rawQuery) {
    return { results: [], pathMatches: [], totalFound: 0, truncated: false, tookMs: 0, apiCallsUsed: 0, page: 1, hasMore: false, totalCount: 0 };
  }

  const cacheKey = JSON.stringify({ q: rawQuery, accounts: params.accounts, repos: params.repos, scope, page, perPage });
  const cachedMatch = liveSearchCache.get(cacheKey);
  if (cachedMatch) {
    return { ...cachedMatch, tookMs: Date.now() - startTime };
  }

  // Pick an authenticated login (accounts come from config, never hardcoded)
  let activeLogin = configuredLogins()[0];
  if (params.accounts && params.accounts.length > 0) {
    activeLogin = params.accounts[0];
  } else {
    const authedAccount = configuredLogins().find(login => getTokenForAccount(login) !== null);
    if (authedAccount) {
      activeLogin = authedAccount;
    }
  }

  const hasToken = getTokenForAccount(activeLogin) !== null;
  if (!hasToken) {
    throw new Error('Live mode requires a GitHub PAT in .env.local (the code-search API needs authentication).');
  }

  const queue = getQueueForAccount(activeLogin);
  await queue.enqueue();

  let codeQuery = `${rawQuery}`;

  if (params.repos && params.repos.length > 0) {
    // Explicit repo scoping always wins, regardless of global/configured.
    for (const repoName of params.repos) {
      codeQuery += ` repo:${repoName}`;
    }
  } else if (scope === 'global') {
    // Global: no user: qualifier → search all of GitHub's indexed code.
    // codeQuery stays as the bare term.
  } else {
    const scopeAccounts = params.accounts && params.accounts.length > 0 ? params.accounts : configuredLogins();
    for (const acc of scopeAccounts) {
      codeQuery += ` user:${acc}`;
    }
  }

  const encodedQuery = encodeURIComponent(codeQuery);
  const searchUrl = `/search/code?q=${encodedQuery}&per_page=${perPage}&page=${page}`;

  try {
    const customHeaders = {
      'Accept': 'application/vnd.github.text-match+json'
    };

    const res = await githubFetch(activeLogin, searchUrl, {
      useETag: false,
      customHeaders
    });

    if (res.status === 429 || res.status === 403) {
      const waitSeconds = res.retryAfterSec || 60;
      queue.freeze(waitSeconds * 1000);
      return {
        results: [],
        pathMatches: [],
        totalFound: 0,
        truncated: false,
        tookMs: Date.now() - startTime,
        apiCallsUsed: 1,
        retryAfterSec: waitSeconds,
        page,
        hasMore: false,
        totalCount: 0
      };
    }

    if (res.status === 401) {
      throw new Error('PAT authentication invalid (401) on live search.');
    }

    if (res.status === 422) {
      // GitHub validation: query too broad / unsupported qualifiers.
      throw new Error('GitHub could not run this query (too broad or unsupported). Add a more specific term.');
    }

    if (res.status !== 200) {
      throw new Error(`GitHub search API returned status ${res.status}.`);
    }

    const results: SearchResult[] = [];
    const payload = res.body;

    if (payload && Array.isArray(payload.items)) {
      for (const item of payload.items) {
        const owner = item.repository?.owner?.login || activeLogin;
        const repo = item.repository?.name || '';
        const filePath = item.path || '';

        if (Array.isArray(item.text_matches)) {
          for (const match of item.text_matches) {
            const fragment = match.fragment || '';

            const matchRanges = Array.isArray(match.matches)
              ? match.matches.map((m: any) => ({
                  start: m.indices[0],
                  length: m.indices[1] - m.indices[0]
                }))
              : [];

            results.push({
              owner,
              repo,
              path: filePath,
              line: maskSecrets(fragment),
              // GitHub's text-match API does not return line numbers;
              // faking "1" produced wrong #L1 deep links.
              lineNumber: null,
              before: null,
              after: null,
              matchRanges
            });
          }
        } else {
          results.push({
            owner,
            repo,
            path: filePath,
            line: `${filePath} matched query`,
            lineNumber: null,
            before: null,
            after: null,
            matchRanges: [{ start: 0, length: filePath.length }]
          });
        }
      }
    }

    const pathMatches = results.map(r => ({ owner: r.owner, repo: r.repo, path: r.path })).slice(0, 10);
    const total = payload?.total_count || results.length;
    // GitHub serves at most 1000 results (10 pages); more pages exist only
    // while there's a full page of items and we're under the page cap.
    const itemsThisPage = Array.isArray(payload?.items) ? payload.items.length : 0;
    const hasMore = page < 10 && itemsThisPage >= perPage && page * perPage < Math.min(total, 1000);
    const response: SearchResponse = {
      results,
      pathMatches,
      totalFound: total,
      truncated: total > Math.min(total, 1000),
      tookMs: Date.now() - startTime,
      apiCallsUsed: 1,
      page,
      hasMore,
      totalCount: total
    };

    liveSearchCache.set(cacheKey, response);

    return response;

  } catch (error: any) {
    logSafe(`Live search failed: ${error?.message}`);
    throw error;
  }
}
