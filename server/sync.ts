import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import {
  INDEX_DIR,
  TMP_DIR,
  ACCOUNTS
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
  status: 'queued' | 'checking' | 'downloading' | 'extracting' | 'indexed' | 'failed' | 'skipped-empty' | 'up-to-date';
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

// Local repository registry to store meta of all known repos from listing
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
  size?: number; // raw size on disk
}

export let globalRepoRegistry: Record<string, RepoRegistryEntry> = {};

/**
 * Ensures system directory tree layout on startup.
 */
export function ensureDirs() {
  if (!fs.existsSync(INDEX_DIR)) {
    fs.mkdirSync(INDEX_DIR, { recursive: true });
  }
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
}

/**
 * Load the repository registry metadata based on available compressed shards inside .cache/index/
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
        
        // Sum total line count across all indexed files
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

  globalRepoRegistry = updatedReg;
  logSafe(`Loaded repo registry from index: ${Object.keys(globalRepoRegistry).length} indexed repositories.`);
}

/**
 * Checks if the local cache is stale by comparing the default branch HEAD SHA with upstream.
 * This is free and fits into our budget math (F-7) as it executes a single light request.
 */
export async function checkStaleness() {
  ensureDirs();
  const accountsToSync = ACCOUNTS;
  
  logSafe(`Checking repository inventory and branch staleness...`);
  
  for (const account of accountsToSync) {
    try {
      const repos = await listUserRepositories(account.login);
      
      for (const repo of repos) {
        const key = `${repo.owner.login}/${repo.name}`;
        const defaultBranch = repo.default_branch || 'main';
        const existing = globalRepoRegistry[key];

        // Ensure we build registry profile even if not synced yet
        if (!existing) {
          globalRepoRegistry[key] = {
            name: repo.name,
            owner: repo.owner.login,
            private: repo.private,
            defaultBranch,
            pushedAt: repo.pushed_at,
            status: 'unknown',
            stale: true
          };
        } else {
          // If pushed_at date is newer or status is not indexed
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
 * Synchronizes repositories sequentially per account, max 2 concurrently to optimize bandwidth.
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
    // 1. Fetch repositories tree representation across all authenticated/demo logins
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
    
    // Initialize status mapping
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

    // Process repositories with concurrency = 2 for account efficiency (M2)
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

    // Spawn 2 parallel threads
    for (let i = 0; i < Math.min(maxConcurrency, queue.length); i++) {
      activeWorkers.push(worker());
    }

    await Promise.all(activeWorkers);
    logSafe(`Full repository synchronizer finished successfully.`);

  } catch (err: any) {
    logSafe(`Sync runtime engine failed: ${err?.message}`);
    globalSyncStatus.errorMessage = err?.message || 'Unknown sync error';
  } finally {
    globalSyncStatus.active = false;
    // Reload search index dynamically on synconization success (M3)
    const { reloadIndex } = await import('./searchIndex.js');
    reloadIndex();
  }
}

/**
 * Synchronizes a single repository: 304 ETag check, downloaded zip parsing, and compressed storage shard save.
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
    // 1. Conditional comparison for commit SHA utilizing headers (F-7)
    progress.status = 'checking';
    const branchUrl = `/repos/${repo.owner.login}/${repo.name}/branches/${defaultBranch}`;
    
    // Check if we have an existing shard for this repo (if not force)
    const hasShard = fs.existsSync(shardPath);
    let upstreamSha = '';

    // Check HEAD Branch commit dynamically
    const branchRes = await githubFetch(login, branchUrl, { useETag: !options.force && hasShard });

    if (branchRes.status === 304 && hasShard) {
      // Up to date! Skip everything.
      progress.status = 'up-to-date';
      const localRegistryEntry = globalRepoRegistry[key];
      if (localRegistryEntry) {
        progress.fileCount = localRegistryEntry.fileCount || 0;
        progress.lineCount = localRegistryEntry.lineCount || 0;
        progress.skipped = localRegistryEntry.skipped || null;
      }
      logSafe(`Skipping ${key}: 304 Not Modified upstream.`);
      return;
    }

    if (branchRes.status === 401) {
      progress.status = 'failed';
      progress.error = 'Invalid authentication token (401)';
      return;
    }

    if (branchRes.status === 404) {
      progress.status = 'failed';
      progress.error = 'Repository default branch not found. Might be empty.';
      return;
    }

    if (branchRes.status === 200 && branchRes.body) {
      upstreamSha = branchRes.body.commit?.sha || '';
    } else {
      // Handle fallback default logic
      upstreamSha = repo.pushed_at;
    }

    // Double check if SHA did not change compared to local registry
    const registryEntry = globalRepoRegistry[key];
    if (registryEntry && registryEntry.sha === upstreamSha && hasShard && !options.force) {
      progress.status = 'up-to-date';
      progress.fileCount = registryEntry.fileCount || 0;
      progress.lineCount = registryEntry.lineCount || 0;
      progress.skipped = registryEntry.skipped || null;
      logSafe(`Skipping ${key}: SHA ${upstreamSha} is identical to cached shard.`);
      return;
    }

    // 2. Fetch Zip ball archive with manual redirect handling (F-2)
    progress.status = 'downloading';
    await downloadRepoZipball(login, repo.owner.login, repo.name, defaultBranch, zipPath);

    // 3. Extract and filter contents under strict limits (HC-10)
    progress.status = 'extracting';
    const parseResult = await extractAndParseZip(zipPath);

    if (parseResult.files.length === 0) {
      progress.status = 'skipped-empty';
      progress.skipped = parseResult.skipped;
      
      // Cleanup zip trace
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      
      // Remove stale shard if any
      if (fs.existsSync(shardPath)) fs.unlinkSync(shardPath);
      return;
    }

    // 4. Compress parsed files representation and save shard
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
    fs.writeFileSync(shardPath, compressed);

    // Update progress metadata properties
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

    // Update memory registry profile
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
      size: compressed.length
    };

    logSafe(`Successfully indexed ${key}. Files: ${progress.fileCount}, Lines: ${progress.lineCount}`);

  } catch (err: any) {
    progress.status = 'failed';
    progress.error = err?.message || 'Sync failed';
    logSafe(`Failed sync on repository ${key}: ${err?.message}`);
  } finally {
    // 5. Cleanup temp archives
    if (fs.existsSync(zipPath)) {
      try {
        fs.unlinkSync(zipPath);
      } catch {}
    }
  }
}
