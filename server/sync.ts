import fs from 'fs';
import { writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import {
  INDEX_DIR,
  TMP_DIR,
  ACCOUNTS,
  DEMO_MAX_REPO_KB
} from './config.js';
import {
  githubFetch,
  downloadRepoZipball,
  listUserRepositories,
  getTokenForAccount,
  logSafe
} from './github.js';
import {
  extractAndParseZip,
  SkippedStats
} from './extract.js';

export interface RepoSyncProgress {
  name: string;
  owner: string;
  isPrivate: boolean;
  status: 'queued' | 'checking' | 'downloading' | 'extracting' | 'indexed' | 'failed' | 'skipped-empty' | 'skipped-demo' | 'deferred' | 'up-to-date';
  fileCount: number;
  lineCount: number;
  skipped: SkippedStats | null;
  error?: string;
  sha?: string;
  syncedAt?: string;
}

export interface SyncStatus {
  active: boolean;
  totalRepos: number;
  completedRepos: number;
  currentRepo: string;
  repos: Record<string, RepoSyncProgress>;
  startedAt: string | null;
  errorMessage: string | null;
}

// Global Sync Status & Mutex
export const globalSyncStatus: SyncStatus = {
  active: false,
  totalRepos: 0,
  completedRepos: 0,
  currentRepo: '',
  repos: {},
  startedAt: null,
  errorMessage: null
};

export interface RepoRegistryEntry {
  name: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string;
  sha?: string;
  syncedAt?: string;
  fileCount?: number;
  lineCount?: number;
  skipped?: SkippedStats | null;
  status: RepoSyncProgress['status'] | 'unknown';
  stale: boolean;
  size?: number; // shard size on disk (bytes)
  repoSizeKb?: number; // upstream repo size (KB, from listing)
}

// const + in-place mutation: consumers hold references obtained at import
// time (including dynamic-import destructuring, which is NOT a live binding),
// so this object must never be reassigned.
export const globalRepoRegistry: Record<string, RepoRegistryEntry> = {};

export function ensureDirs() {
  if (!fs.existsSync(INDEX_DIR)) {
    fs.mkdirSync(INDEX_DIR, { recursive: true });
  }
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
}

export function hasAnyToken(): boolean {
  return ACCOUNTS.some(a => getTokenForAccount(a.login) !== null);
}

/**
 * Load the repository registry metadata from existing shards in .cache/index/
 */
export function loadRepoRegistry() {
  ensureDirs();
  const shards = fs.readdirSync(INDEX_DIR);
  const updatedReg: Record<string, RepoRegistryEntry> = {};

  for (const shard of shards) {
    if (shard.endsWith('.json.gz')) {
      const shardPath = path.join(INDEX_DIR, shard);
      try {
        const compressed = fs.readFileSync(shardPath);
        const decompressed = zlib.gunzipSync(compressed).toString('utf8');
        const payload = JSON.parse(decompressed);
        const key = `${payload.meta.owner}/${payload.meta.repo}`;

        let totalLines = 0;
        if (Array.isArray(payload.files)) {
          for (const file of payload.files) {
            totalLines += file.lines.length;
          }
        }

        updatedReg[key] = {
          name: payload.meta.repo,
          owner: payload.meta.owner,
          private: payload.meta.private,
          defaultBranch: payload.meta.defaultBranch || 'main',
          pushedAt: payload.meta.pushedAt || new Date().toISOString(),
          sha: payload.meta.sha,
          syncedAt: payload.meta.syncedAt,
          fileCount: payload.files ? payload.files.length : 0,
          lineCount: totalLines,
          skipped: payload.skipped || null,
          status: 'indexed',
          stale: false,
          size: fs.statSync(shardPath).size
        };
      } catch (err) {
        console.error(`Failed to read shard ${shard}:`, err);
      }
    }
  }

  for (const key of Object.keys(globalRepoRegistry)) {
    delete globalRepoRegistry[key];
  }
  Object.assign(globalRepoRegistry, updatedReg);
  logSafe(`Loaded repo registry from index: ${Object.keys(globalRepoRegistry).length} indexed repositories.`);
}

/**
 * Refresh the repo inventory and flag stale entries by comparing pushed_at.
 * Skipped automatically when no account has a token: each boot would otherwise
 * burn the unauthenticated 60 req/hr budget (T-15).
 */
export async function checkStaleness() {
  ensureDirs();

  if (!hasAnyToken()) {
    logSafe('Staleness check skipped: no tokens configured (demo mode preserves the 60 req/hr budget).');
    return;
  }

  logSafe('Checking repository inventory and branch staleness...');

  for (const account of ACCOUNTS) {
    try {
      const repos = await listUserRepositories(account.login);

      for (const repo of repos) {
        const key = `${repo.owner.login}/${repo.name}`;
        const defaultBranch = repo.default_branch || 'main';
        const existing = globalRepoRegistry[key];

        if (!existing) {
          globalRepoRegistry[key] = {
            name: repo.name,
            owner: repo.owner.login,
            private: repo.private,
            defaultBranch,
            pushedAt: repo.pushed_at,
            status: 'unknown',
            stale: true,
            repoSizeKb: repo.size
          };
        } else {
          existing.repoSizeKb = repo.size;
          const existingPush = new Date(existing.pushedAt).getTime();
          const remotePush = new Date(repo.pushed_at).getTime();

          if (remotePush > existingPush + 1000) {
            existing.stale = true;
            existing.pushedAt = repo.pushed_at;
          }
        }
      }
    } catch (err: any) {
      logSafe(`Staleness check failed for account ${account.login}: ${err?.message}`);
    }
  }
}

/**
 * Synchronizes repositories, max 2 concurrently, guarded by a mutex.
 */
export async function runFullSync(options: { force?: boolean } = {}) {
  if (globalSyncStatus.active) {
    throw new Error('Sync already in progress (mutex active).');
  }

  ensureDirs();
  globalSyncStatus.active = true;
  globalSyncStatus.startedAt = new Date().toISOString();
  globalSyncStatus.errorMessage = null;
  globalSyncStatus.completedRepos = 0;
  globalSyncStatus.totalRepos = 0;
  globalSyncStatus.repos = {};

  try {
    const reposToProcess: Array<{ login: string; repo: any }> = [];

    for (const account of ACCOUNTS) {
      logSafe(`Listing repos for sync: ${account.login}`);
      try {
        const list = await listUserRepositories(account.login);
        for (const item of list) {
          reposToProcess.push({ login: account.login, repo: item });
        }
      } catch (err: any) {
        logSafe(`Failed to list repos for account ${account.login}: ${err?.message}`);
      }
    }

    globalSyncStatus.totalRepos = reposToProcess.length;

    for (const item of reposToProcess) {
      const key = `${item.repo.owner.login}/${item.repo.name}`;
      globalSyncStatus.repos[key] = {
        name: item.repo.name,
        owner: item.repo.owner.login,
        isPrivate: item.repo.private,
        status: 'queued',
        fileCount: 0,
        lineCount: 0,
        skipped: null
      };
    }

    const queue = [...reposToProcess];
    const activeWorkers: Promise<void>[] = [];
    const maxConcurrency = 2;

    const worker = async () => {
      while (queue.length > 0) {
        const currentTask = queue.shift();
        if (!currentTask) break;

        const { login, repo } = currentTask;
        const key = `${repo.owner.login}/${repo.name}`;
        globalSyncStatus.currentRepo = key;

        await syncSingleRepository(login, repo, options);
        globalSyncStatus.completedRepos++;
      }
    };

    for (let i = 0; i < Math.min(maxConcurrency, queue.length); i++) {
      activeWorkers.push(worker());
    }

    await Promise.all(activeWorkers);
    logSafe('Full repository sync finished.');

  } catch (err: any) {
    logSafe(`Sync runner failed: ${err?.message}`);
    globalSyncStatus.errorMessage = err?.message || 'Unknown sync error';
  } finally {
    globalSyncStatus.active = false;
    // Reload search index after sync (main-thread copy + regex worker copy)
    const { reloadIndex } = await import('./searchIndex.js');
    reloadIndex();
  }
}

/**
 * Sync one repository: conditional HEAD check, zipball, extraction, shard.
 */
async function syncSingleRepository(login: string, repo: any, options: { force?: boolean } = {}) {
  const key = `${repo.owner.login}/${repo.name}`;
  const progress = globalSyncStatus.repos[key];
  if (!progress) return;

  const defaultBranch = repo.default_branch || 'main';
  const shardName = `${login}__${repo.name}.json.gz`;
  const shardPath = path.join(INDEX_DIR, shardName);
  const zipPath = path.join(TMP_DIR, `${login}__${repo.name}.zip`);

  try {
    // Demo guard: without a token, large repos would burn the tiny budget.
    const hasToken = getTokenForAccount(login) !== null;
    if (!hasToken && typeof repo.size === 'number' && repo.size > DEMO_MAX_REPO_KB) {
      progress.status = 'skipped-demo';
      progress.error = `Repo ~${Math.round(repo.size / 1024)} MB > demo limit ${Math.round(DEMO_MAX_REPO_KB / 1024)} MB (add a PAT to sync it)`;
      logSafe(`Skipping ${key} in demo mode: ${repo.size} KB exceeds demo cap.`);
      return;
    }

    progress.status = 'checking';
    const branchUrl = `/repos/${repo.owner.login}/${repo.name}/branches/${defaultBranch}`;

    const hasShard = fs.existsSync(shardPath);
    let upstreamSha = '';

    const branchRes = await githubFetch(login, branchUrl, { useETag: !options.force && hasShard });

    if (branchRes.status === 304 && hasShard) {
      progress.status = 'up-to-date';
      const localRegistryEntry = globalRepoRegistry[key];
      if (localRegistryEntry) {
        progress.fileCount = localRegistryEntry.fileCount || 0;
        progress.lineCount = localRegistryEntry.lineCount || 0;
        progress.skipped = localRegistryEntry.skipped || null;
      }
      return;
    }

    if (branchRes.status === 401) {
      progress.status = 'failed';
      progress.error = 'Invalid authentication token (401)';
      return;
    }

    if (branchRes.status === 404) {
      progress.status = 'skipped-empty';
      progress.error = 'Default branch not found (repository may be empty).';
      return;
    }

    if (branchRes.status === 429) {
      progress.status = 'deferred';
      progress.error = `Rate limited; retry after ~${branchRes.retryAfterSec || 60}s`;
      return;
    }

    if (branchRes.status === 200 && branchRes.body) {
      upstreamSha = branchRes.body.commit?.sha || '';
    } else {
      upstreamSha = repo.pushed_at;
    }

    const registryEntry = globalRepoRegistry[key];
    if (registryEntry && registryEntry.sha === upstreamSha && hasShard && !options.force) {
      progress.status = 'up-to-date';
      progress.fileCount = registryEntry.fileCount || 0;
      progress.lineCount = registryEntry.lineCount || 0;
      progress.skipped = registryEntry.skipped || null;
      return;
    }

    progress.status = 'downloading';
    await downloadRepoZipball(login, repo.owner.login, repo.name, defaultBranch, zipPath);

    progress.status = 'extracting';
    const parseResult = await extractAndParseZip(zipPath);

    if (parseResult.files.length === 0) {
      progress.status = 'skipped-empty';
      progress.skipped = parseResult.skipped;
      if (fs.existsSync(shardPath)) await unlink(shardPath).catch(() => {});
      return;
    }

    const shardPayload = {
      meta: {
        owner: repo.owner.login,
        repo: repo.name,
        private: repo.private,
        defaultBranch,
        sha: upstreamSha,
        pushedAt: repo.pushed_at,
        syncedAt: new Date().toISOString()
      },
      files: parseResult.files,
      skipped: parseResult.skipped
    };

    const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(shardPayload), 'utf8'));
    await writeFile(shardPath, compressed);

    let lineSum = 0;
    for (const f of parseResult.files) {
      lineSum += f.lines.length;
    }

    progress.status = 'indexed';
    progress.fileCount = parseResult.files.length;
    progress.lineCount = lineSum;
    progress.skipped = parseResult.skipped;
    progress.sha = upstreamSha;
    progress.syncedAt = shardPayload.meta.syncedAt;

    globalRepoRegistry[key] = {
      name: repo.name,
      owner: repo.owner.login,
      private: repo.private,
      defaultBranch,
      pushedAt: repo.pushed_at,
      sha: upstreamSha,
      syncedAt: shardPayload.meta.syncedAt,
      fileCount: parseResult.files.length,
      lineCount: lineSum,
      skipped: parseResult.skipped,
      status: 'indexed',
      stale: false,
      size: compressed.length,
      repoSizeKb: repo.size
    };

    logSafe(`Indexed ${key}. Files: ${progress.fileCount}, Lines: ${progress.lineCount}`);

  } catch (err: any) {
    progress.status = 'failed';
    progress.error = err?.message || 'Sync failed';
    logSafe(`Failed sync on repository ${key}: ${err?.message}`);
  } finally {
    if (fs.existsSync(zipPath)) {
      await unlink(zipPath).catch(() => {});
    }
  }
}
