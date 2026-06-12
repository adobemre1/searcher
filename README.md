# ecysearch — Zero-Token, Zero-Cost GitHub Keyword Searcher

Local-first code search across all of your GitHub repositories. Mirror your
repos once, then search **any word** instantly: substring, whole-word, regex,
boolean (`"exact phrase" -negation term`), local semantic ranking, and
Turkish folding (`danisman` ⇄ `danışman`) — **offline-capable, with zero
GitHub API calls per search and zero LLM tokens, ever.**

## Quick start (macOS)

```bash
node -v                      # must be ≥ 20
npm install
cp .env.example .env.local   # paste your PATs (see Token scopes below)
npm run dev                  # http://127.0.0.1:3000
```

If port 3000 is taken (Docker likes it), set `PORT=3020` in `.env.local`.

Then in the app: **Sync Status → Sync All** → wait for green rows → type
`danisman` and press **Enter** → results arrive with `API calls: 0`, the
found word lands in the **Notebook** (System button → Words tab), and every
result row deep-links to the exact line on github.com.

## Token scopes

Fine-grained PAT per account — *Repository access:* All repositories →
*Permissions:* **Contents: Read-only** + **Metadata: Read-only**. Nothing else.
Live mode over private repos works best with a classic PAT (`repo` scope) —
optional; Mirror mode does not need it.

Tokens live only in `.env.local`, are read server-side only, never reach the
browser bundle, responses, or logs.

## Search modes

| Mode | Engine | Cost per query |
|---|---|---|
| **Mirror** (default) | local index; substring / boolean / whole-word / regex; TR fold | 0 API calls |
| **Semantic** | local TF-IDF + BM25 saturation + cosine ranking (tunable in Engine Calibration) | 0 API calls |
| **Live** | GitHub `/search/code` proxy — word-boundary matching, default branch, < 384 KB files, ~10 queries/min, single-flight queue ≥ 6.5 s spacing | 1 API call (cached 5 min) |

Mirror/semantic search as you type (300 ms debounce). Live fires on Enter only.

## The Notebook (search journal)

Every **committed** search — Enter, or a query left unchanged for ≥ 1.5 s,
minimum 3 characters — is noted in `.cache/journal/`:

- `journal.jsonl` — the detailed trail (rotated at 5 MB; consecutive repeats
  of the same query+flags coalesce with a `×N` counter),
- `words.json` — the durable found-words aggregate (survives rotation),
- export as Markdown or JSON from the System drawer; clear keeps nothing.

Secret-shaped queries (tokens, API keys…) are **never persisted** — they are
counted as "redacted" instead. Result fragments are never stored. Journaling
runs outside the search hot path and disables itself via a circuit breaker
after repeated write failures (search is never affected). Opt out with
`JOURNAL_ENABLED=false`.

## Architecture (why it can't be rate-limited)

- **Sync** = list repos → conditional HEAD check per repo (ETag; 304s are free
  and don't count against quota) → download zipballs only for changed repos
  (manual-redirect dance: Node strips the Authorization header on the
  cross-origin redirect to codeload.github.com, so the pre-signed Location is
  followed explicitly without auth) → stream-extract with filters (binaries,
  `node_modules`, lockfiles, > 1 MB files skipped and **counted**) → one
  compressed shard per repo under `.cache/index/`.
- Cold sync of ~30 repos ≈ 60–70 core calls ≈ ~1% of the 5,000/hr budget.
  A no-change re-sync is almost entirely 304s. Searches after that: **zero**.
- **Regex safety**: user patterns run in a worker thread with a 2 s hard
  deadline (`worker.terminate()`); catastrophic backtracking cannot freeze the
  server. Patterns are capped at 256 chars.
- **Bind**: `127.0.0.1` by default (`HOST` env to override — only do that in a
  sandboxed container). Mutating endpoints require an `X-Ecysearch: 1` header,
  which blocks cross-site request forgery against localhost.
- Secret masking (GitHub/Google/AWS/OpenAI key shapes, generic `token=`
  assignments) is applied server-side to every returned line.

## Commands

```bash
npm run dev          # Express + Vite middleware on one port (default 3000)
npm run build        # vite build + server typecheck
npm run start        # serve the built dist/ (NODE_ENV=production)
npm run typecheck    # web + server, strict
npm run lint:guard   # tripwire: banned patterns (AI SDKs, 0.0.0.0, blur, fabricated-hardware strings)
npm run clean        # remove dist/ and .cache/tmp
```

`.cache/` is always safe to delete — the index rebuilds on the next sync
(the notebook's `words.json` is the only thing you might export first).

## Non-goals

- Only the **default branch** of each repo is indexed (GitHub's API behaves
  the same way). No git history search. Submodule contents are not included
  (zipballs exclude them). No public deployment story: tokens belong on your
  machine.

## Decisions log

- `blob/HEAD/` is used for all GitHub deep links — it resolves to the default
  branch without tracking branch names per repo.
- Live-mode fragments carry `lineNumber: null` (GitHub's text-match API gives
  no line numbers) and link without a `#L` anchor instead of guessing.
- Semantic explanations are generated **locally** from the ranking stats; the
  earlier Gemini-backed explanation path was removed to keep the zero-token
  contract honest.
- The earlier fabricated telemetry panel ("M4 Pro Max", simulated core loads)
  was replaced by measured values only: `os.cpus()`, `os.loadavg()`,
  `process.memoryUsage()`, real index stats and journal-derived averages.
