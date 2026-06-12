import fs from 'fs';
import { writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import {
  INDEX_DIR,
  TMP_DIR,
  ACCOUNTS,
  DEMO_MAX_REPO_KB,
  shardFileName,
  safeRepoSegment
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
import { listExternal } from './external.js';

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
  external?: boolean; // tracked beyond the configured accounts
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

// External repos are fetched with whichever account has a token (it only
// gates rate-limit headroom; public repos download tokenless too). Falls back
// to the first configured login for the unauthenticated path.
function pickAuthedLogin(): string {
  const authed = ACCOUNTS.find(a => getTokenForAccount(a.login) !== null);
  return authed ? authed.login : (ACCOUNTS[0]?.login || 'unauthenticated');
}

/**
 * Resolves each tracked external "owner/repo" to a repo-meta object shaped
 * like the listing API (owner.login, name, default_branch, private, size,
 * pushed_at) plus a `__external` marker. Inaccessible repos surface as failed.
 */
async function fetchExternalMetas(): Promise<Array<{ login: string; repo: any; failed?: string }>> {
  const externals = listExternal();
  if (externals.length === 0) return [];
  const login = pickAuthedLogin();
  const out: Array<{ login: string; repo: any; failed?: string }> = [];

  for (const id of externals) {
    const [owner, name] = id.split('/');
    try {
      const res = await githubFetch(login, `/repos/${owner}/${name}`, { useETag: false });
      if (res.status === 200 && res.body && res.body.owner) {
        out.push({ login, repo: { ...res.body, __external: true } });
      } else if (res.status === 404) {
        out.push({ login, repo: { owner: { login: owner }, name, __external: true }, failed: 'not found or no access' });
      } else if (res.status === 429) {
        out.push({ login, repo: { owner: { login: owner }, name, __external: true }, failed: 'rate limited' });
      } else {
        out.push({ login, repo: { owner: { login: owner }, name, __external: true }, failed: `status ${res.status}` });
      }
    } catch (err: any) {
      out.push({ login, repo: { owner: { login: owner }, name, __external: true }, failed: err?.message || 'fetch failed' });
    }
  }
  return out;
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
          size: fs.statSync(shardPath).size,
          external: payload.meta.external === true
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

  const inventory: Array<{ repo: any; external: boolean }> = [];
  for (const account of ACCOUNTS) {
    try {
      const repos = await listUserRepositories(account.login);
      for (const repo of repos) inventory.push({ repo, external: false });
    } catch (err: any) {
      logSafe(`Staleness check failed for account ${account.login}: ${err?.message}`);
    }
  }
  for (const ext of await fetchExternalMetas()) {
    if (!ext.failed) inventory.push({ repo: ext.repo, external: true });
  }

  for (const { repo, external } of inventory) {
    const key = `${repo.owner.login}/${repo.name}`;
    const defaultBranch = repo.default_branch || 'main';
    const existing = globalRepoRegistry[key];

    if (!existing) {
      globalRepoRegistry[key] = {
        name: repo.name,
        owner: repo.owner.login,
        private: !!repo.private,
        defaultBranch,
        pushedAt: repo.pushed_at || new Date().toISOString(),
        status: 'unknown',
        stale: true,
        repoSizeKb: repo.size,
        external
      };
    } else {
      existing.repoSizeKb = repo.size;
      existing.external = external;
      if (repo.pushed_at) {
        const existingPush = new Date(existing.pushedAt).getTime();
        const remotePush = new Date(repo.pushed_at).getTime();
        if (remotePush > existingPush + 1000) {
          existing.stale = true;
          existing.pushedAt = repo.pushed_at;
        }
      }
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

    // Tracked external repositories (any owner, beyond the configured accounts)
    for (const ext of await fetchExternalMetas()) {
      if (ext.failed) {
        const key = `${ext.repo.owner.login}/${ext.repo.name}`;
        globalSyncStatus.repos[key] = {
          name: ext.repo.name,
          owner: ext.repo.owner.login,
          isPrivate: false,
          status: 'failed',
          fileCount: 0,
          lineCount: 0,
          skipped: null,
          error: ext.failed
        };
      } else {
        reposToProcess.push({ login: ext.login, repo: ext.repo });
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
 * Sync a single external repo immediately (used right after the user adds one).
 * Honors the same mutex as a full sync to avoid concurrent index writes.
 */
export async function syncSingleExternal(ownerRepo: string): Promise<{ ok: boolean; error?: string }> {
  if (globalSyncStatus.active) {
    return { ok: false, error: 'A sync is already in progress; the repo will be picked up on the next sync.' };
  }
  const [owner, name] = ownerRepo.split('/');
  if (!owner || !name) return { ok: false, error: 'Expected "owner/repo".' };

  const login = pickAuthedLogin();
  let meta: any;
  try {
    const res = await githubFetch(login, `/repos/${owner}/${name}`, { useETag: false });
    if (res.status === 404) return { ok: false, error: 'Repository not found or no access.' };
    if (res.status === 429) return { ok: false, error: 'Rate limited; try again shortly.' };
    if (res.status !== 200 || !res.body?.owner) return { ok: false, error: `GitHub returned status ${res.status}.` };
    meta = { ...res.body, __external: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to fetch repository metadata.' };
  }

  const key = `${meta.owner.login}/${meta.name}`;
  globalSyncStatus.active = true;
  globalSyncStatus.startedAt = new Date().toISOString();
  globalSyncStatus.errorMessage = null;
  globalSyncStatus.repos[key] = {
    name: meta.name,
    owner: meta.owner.login,
    isPrivate: !!meta.private,
    status: 'queued',
    fileCount: 0,
    lineCount: 0,
    skipped: null
  };
  globalSyncStatus.currentRepo = key;

  try {
    await syncSingleRepository(login, meta, { force: true });
  } finally {
    globalSyncStatus.active = false;
    const { reloadIndex } = await import('./searchIndex.js');
    reloadIndex();
  }

  const entry = globalRepoRegistry[key];
  if (entry && entry.status === 'indexed') return { ok: true };
  const prog = globalSyncStatus.repos[key];
  return { ok: false, error: prog?.error || 'Sync did not index any files.' };
}

/**
 * Sync one repository: conditional HEAD check, zipball, extraction, shard.
 */
async function syncSingleRepository(login: string, repo: any, options: { force?: boolean } = {}) {
  const key = `${repo.owner.login}/${repo.name}`;
  const progress = globalSyncStatus.repos[key];
  if (!progress) return;

  const owner = repo.owner.login;
  const isExternal = repo.__external === true;
  const defaultBranch = repo.default_branch || 'main';
  // Shard/zip names are owner-based (so any repo is unique) and sanitized
  // (external owner/repo is user input → never a path separator/traversal).
  const shardName = shardFileName(owner, repo.name);
  const shardPath = path.join(INDEX_DIR, shardName);
  const zipPath = path.join(TMP_DIR, `${safeRepoSegment(owner)}__${safeRepoSegment(repo.name)}.zip`);

  try {
    // Demo guard: without a token, large repos would burn the tiny budget.
    // External repos are explicitly opted in, so they bypass the demo cap.
    const hasToken = getTokenForAccount(login) !== null;
    if (!hasToken && !isExternal && typeof repo.size === 'number' && repo.size > DEMO_MAX_REPO_KB) {
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
        private: !!repo.private,
        defaultBranch,
        sha: upstreamSha,
        pushedAt: repo.pushed_at || new Date().toISOString(),
        syncedAt: new Date().toISOString(),
        external: isExternal
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
      private: !!repo.private,
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
      repoSizeKb: repo.size,
      external: isExternal
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
