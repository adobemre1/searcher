import fs from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';

// ---------------------------------------------------------------------------
// External repositories — any public (or collaborator-accessible) GitHub repo
// the user wants to mirror and search, beyond their own configured accounts.
//
// Stored as a plain, committable list at the project root so the set travels
// with the repo. Entries are "owner/repo". All writes go through one chain.
// ---------------------------------------------------------------------------

const EXTERNAL_FILE = path.join(process.cwd(), 'external-repos.json');

const OWNER_REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

let chain: Promise<void> = Promise.resolve();

export function normalizeRepoId(input: string): string | null {
  let s = (input || '').trim();
  if (!s) return null;
  // Accept full URLs and trailing .git
  s = s.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/,'');
  if (!OWNER_REPO_RE.test(s)) return null;
  return s;
}

export function listExternal(): string[] {
  try {
    if (!fs.existsSync(EXTERNAL_FILE)) return [];
    const parsed = JSON.parse(fs.readFileSync(EXTERNAL_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(x => typeof x === 'string' && OWNER_REPO_RE.test(x));
  } catch {
    return [];
  }
}

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

async function persist(list: string[]): Promise<void> {
  await writeFile(EXTERNAL_FILE, JSON.stringify(list, null, 2) + '\n', 'utf8');
}

export function addExternal(input: string): Promise<{ ok: boolean; repo?: string; error?: string }> {
  return enqueue(async () => {
    const repo = normalizeRepoId(input);
    if (!repo) {
      return { ok: false, error: 'Expected "owner/repo".' };
    }
    let list: string[] = [];
    try {
      list = JSON.parse(await readFile(EXTERNAL_FILE, 'utf8'));
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
    if (!list.includes(repo)) {
      list.push(repo);
      list.sort();
      await persist(list);
    }
    return { ok: true, repo };
  });
}

export function removeExternal(input: string): Promise<{ ok: boolean; repo?: string }> {
  return enqueue(async () => {
    const repo = normalizeRepoId(input) || (input || '').trim();
    let list: string[] = [];
    try {
      list = JSON.parse(await readFile(EXTERNAL_FILE, 'utf8'));
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }
    const next = list.filter(r => r !== repo);
    await persist(next);
    return { ok: true, repo };
  });
}
