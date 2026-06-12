import path from 'path';

export interface GitHubAccountConfig {
  login: string;
  tokenEnv: string;
}

export const ACCOUNTS: GitHubAccountConfig[] = [
  { login: 'eCy-coding', tokenEnv: 'GITHUB_TOKEN_ECY_CODING' },
  { login: 'adobemre1', tokenEnv: 'GITHUB_TOKEN_ADOBEMRE1' }
];

export const PORT = 3000; // Hardcoded by infrastructure requirements

export const CACHE_DIR = path.join(process.cwd(), '.cache');
export const INDEX_DIR = path.join(CACHE_DIR, 'index');
export const TMP_DIR = path.join(CACHE_DIR, 'tmp');
export const ETAGS_FILE = path.join(CACHE_DIR, 'etags.json');

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
