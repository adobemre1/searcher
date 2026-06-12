#!/usr/bin/env node
// lint:guard — tripwire against banned patterns re-entering the codebase.
// Scans source + config files; exits 1 on any hit. Docs (README) are exempt.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();

const BANNED = [
  { pattern: /@google\/genai/, why: 'zero-LLM contract: no AI SDK' },
  { pattern: /GEMINI_API_KEY/, why: 'zero-LLM contract: no Gemini key references' },
  { pattern: /MAJOR_CAPABILITY/, why: 'metadata must not claim AI capabilities' },
  { pattern: /from ['"]motion/, why: 'dead dependency must stay removed' },
  { pattern: /backdrop-blur/, why: 'design doctrine: solid surfaces only' },
  { pattern: /M4 Pro|Hyper-Optimized|quantum_core/i, why: 'no fabricated hardware claims' },
  { pattern: /listen\(\s*PORT\s*,\s*['"]0\.0\.0\.0['"]/, why: 'bind must come from HOST env (default 127.0.0.1)' },
];

const SCAN_TARGETS = ['package.json', 'metadata.json', 'index.html', 'server', 'src', 'scripts'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.cache', '.git']);
const SELF = 'scripts/guard.mjs';

function* walk(p) {
  const st = statSync(p);
  if (st.isDirectory()) {
    if (SKIP_DIRS.has(p.split('/').pop())) return;
    for (const entry of readdirSync(p)) yield* walk(join(p, entry));
  } else {
    yield p;
  }
}

let failures = 0;
for (const target of SCAN_TARGETS) {
  let files = [];
  try {
    files = [...walk(join(ROOT, target))];
  } catch {
    continue;
  }
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (rel === SELF) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const { pattern, why } of BANNED) {
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (pattern.test(line)) {
          console.error(`GUARD FAIL ${rel}:${i + 1} — ${why}\n  ${line.trim().slice(0, 120)}`);
          failures++;
        }
      });
    }
  }
}

if (failures > 0) {
  console.error(`\nlint:guard: ${failures} banned pattern hit(s).`);
  process.exit(1);
}
console.log('lint:guard: clean.');
