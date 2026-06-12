import path from 'path';

export interface GitHubAccountConfig {
  login: string;
  tokenEnv: string;
}

export const ACCOUNTS: GitHubAccountConfig[] = [
  { login: 'eCy-coding', tokenEnv: 'GITHUB_TOKEN_ECY_CODING' },
  { login: 'adobemre1', tokenEnv: 'GITHUB_TOKEN_ADOBEMRE1' }
];

// Loopback by default: this is a personal local tool serving private repo
// contents with no auth layer. HOST=0.0.0.0 only for sandboxed containers.
export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = Number(process.env.PORT) || 3000;

export const JOURNAL_ENABLED = process.env.JOURNAL_ENABLED !== 'false';

// Shard/zip filenames are derived from owner/repo, which for external repos is
// user input. Collapse anything outside the safe set so the value can never
// contain a path separator or traversal segment before it reaches path.join.
export function safeRepoSegment(s: string): string {
  return (s || '').replace(/[^A-Za-z0-9._-]/g, '_');
}

export function shardFileName(owner: string, repo: string): string {
  return `${safeRepoSegment(owner)}__${safeRepoSegment(repo)}.json.gz`;
}

export const CACHE_DIR = path.join(process.cwd(), '.cache');
export const INDEX_DIR = path.join(CACHE_DIR, 'index');
export const TMP_DIR = path.join(CACHE_DIR, 'tmp');
export const ETAGS_FILE = path.join(CACHE_DIR, 'etags.json');
export const JOURNAL_DIR = path.join(CACHE_DIR, 'journal');

// Excluded directories from scanning
export const EXCLUDED_DIRS = [
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  'vendor',
  'coverage',
  '.git',
  '.cache',
  'bin',
  'obj'
];

// Excluded files or match patterns
export const EXCLUDED_FILES = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  '*.min.css',
  '*.min.js',
  '*.map'
];

// Excluded binary/large file extensions
export const EXCLUDED_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'pdf', 'zip', 'gz', 'tar', 'woff',
  'woff2', 'ttf', 'eot', 'mp3', 'mp4', 'mov', 'webm', 'wasm', 'jar', 'class',
  'exe', 'dll', 'so', 'dylib', 'db', 'sqlite', 'bin'
];

// Budget-constraints per repository
export const MAX_FILES_PER_REPO = 5000;
export const MAX_TEXT_SIZE_BYTES_PER_REPO = 50 * 1024 * 1024; // 50 MB
export const MAX_SINGLE_FILE_SIZE_BYTES = 1024 * 1024; // 1 MB

// Demo mode (no token for the account): skip repos larger than this to
// protect the unauthenticated 60 req/hr budget. GitHub lists size in KB.
export const DEMO_MAX_REPO_KB = 10 * 1024; // 10 MB

// Regex search guard rails
export const REGEX_MAX_PATTERN_LENGTH = 256;
export const REGEX_TIMEOUT_MS = 2000;
