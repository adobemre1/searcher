// Regex search worker. Plain ESM JavaScript on purpose: it must spawn cleanly
// under both `tsx` (dev) and plain `node`, with no loader assumptions.
//
// Why a worker: a catastrophic-backtracking pattern hangs inside a single
// String.match() call, which cannot be interrupted on the main thread. The
// main thread enforces a hard deadline via worker.terminate(); this worker
// additionally self-checks a soft time budget between lines.
import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const INDEX_DIR = workerData?.indexDir;

const FOLD_MAP = { 'ı': 'i', 'ş': 's', 'ç': 'c', 'ğ': 'g', 'ü': 'u', 'ö': 'o' };

function foldTurkish(str) {
  if (!str) return '';
  let folded = str.toLocaleLowerCase('tr-TR').replace(/̇/g, '');
  let result = '';
  for (let i = 0; i < folded.length; i++) {
    const ch = folded[i];
    result += FOLD_MAP[ch] !== undefined ? FOLD_MAP[ch] : ch;
  }
  return result;
}

let index = null; // [{ owner, repo, path, lines, foldedLines }]

function loadIndex() {
  const next = [];
  if (INDEX_DIR && fs.existsSync(INDEX_DIR)) {
    const shards = fs.readdirSync(INDEX_DIR).filter(s => s.endsWith('.json.gz'));
    for (const shard of shards) {
      try {
        const compressed = fs.readFileSync(path.join(INDEX_DIR, shard));
        const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
        const owner = payload.meta.owner;
        const repo = payload.meta.repo;
        if (Array.isArray(payload.files)) {
          for (const file of payload.files) {
            const rawLines = file.lines || [];
            next.push({
              owner,
              repo,
              path: file.path,
              lines: rawLines,
              foldedLines: rawLines.map(foldTurkish)
            });
          }
        }
      } catch {
        // skip unreadable shard
      }
    }
  }
  index = next;
}

function ensureIndex() {
  if (index === null) loadIndex();
}

parentPort.on('message', (msg) => {
  if (msg.type === 'reload') {
    index = null; // lazy reload on next search
    return;
  }
  if (msg.type !== 'search') return;

  const { id, pattern, flags, plane, filters, limit, timeBudgetMs } = msg;

  let regex;
  try {
    regex = new RegExp(pattern, flags);
  } catch (err) {
    parentPort.postMessage({ id, error: `Invalid search regex pattern: ${err.message}` });
    return;
  }

  ensureIndex();

  const accountFilter = filters.accounts && filters.accounts.length > 0 ? new Set(filters.accounts) : null;
  const repoFilter = filters.repos && filters.repos.length > 0 ? new Set(filters.repos) : null;
  // External owners are exempt from the account filter (see searchIndex.ts).
  const configuredOwners = new Set((filters.configuredOwners || []).map(o => o.toLowerCase()));
  const pathNeedle = filters.pathQuery ? filters.pathQuery.toLowerCase() : null;
  const extFilter = filters.ext ? filters.ext.toLowerCase().replace(/^\./, '') : null;

  const startTime = Date.now();
  const results = [];
  let totalFound = 0;
  let truncated = false;
  let lineCounter = 0;

  try {
    outer: for (const file of index) {
      const key = `${file.owner}/${file.repo}`;
      if (accountFilter && configuredOwners.has(file.owner.toLowerCase()) && !accountFilter.has(file.owner)) continue;
      if (repoFilter && !repoFilter.has(key)) continue;
      if (pathNeedle && !file.path.toLowerCase().includes(pathNeedle)) continue;
      if (extFilter) {
        const fileExt = file.path.split('.').pop()?.toLowerCase();
        if (fileExt !== extFilter) continue;
      }

      const lineCount = file.lines.length;
      for (let i = 0; i < lineCount; i++) {
        lineCounter++;
        if (lineCounter % 2000 === 0 && Date.now() - startTime > timeBudgetMs) {
          parentPort.postMessage({ id, error: 'REGEX_TIMEOUT' });
          return;
        }

        const rawLine = file.lines[i];
        const target = plane === 'folded'
          ? file.foldedLines[i]
          : plane === 'lower'
            ? rawLine.toLowerCase()
            : rawLine;

        const m = target.match(regex);
        if (m && m.index !== undefined) {
          totalFound++;
          if (results.length < limit) {
            results.push({
              owner: file.owner,
              repo: file.repo,
              path: file.path,
              lineNumber: i + 1,
              line: rawLine,
              before: i > 0 ? file.lines[i - 1] : null,
              after: i < lineCount - 1 ? file.lines[i + 1] : null,
              matchRanges: [{ start: m.index, length: m[0].length || 1 }]
            });
          } else {
            truncated = true;
            if (totalFound > limit * 4) break outer; // enough signal, stop scanning
          }
        }
      }
    }
  } catch (err) {
    parentPort.postMessage({ id, error: err?.message || 'regex scan failed' });
    return;
  }

  parentPort.postMessage({ id, results, totalFound, truncated });
});
