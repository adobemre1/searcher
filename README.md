# ecysearch: Zero-Token, Zero-Cost GitHub Keyword Searcher

A local-first, zero-overhead code indexer and search portal for your active development projects. Works instantly, handles diacritics under custom Turkish folding rules, shields sensitive tokens from leak, and functions fully offline.

---

## 🚀 macOS E2E Runbook & Quick Start

### 1. Requirements
Ensure your laptop has **Node.js ≥ 20** installed:
```bash
node -v # Check node version
```

### 2. Installations
Clone or download the project folder, open terminal in folder root, and install the base dependencies:
```bash
npm install
```

### 3. Setup credentials
Copy the default env configuration and set your personal access tokens:
```bash
cp .env.example .env.local
```
Edit `.env.local` to paste your GitHub PAT tokens:
```env
GITHUB_TOKEN_ECY_CODING="ghp_..."
GITHUB_TOKEN_ADOBEMRE1="ghp_..."
```

*Note: fine-grained PATs require only **Contents: Read-only** and **Metadata: Read-only** permissions over repositories. Tokens always remain secure on your MacBook and are parsed exclusively server-side.*

### 4. Spawning dev environment
Launch full-stack server on Port 3000:
```bash
npm run dev
```

Open `http://localhost:3000` inside your preferred browser.

1. Press **Sync Status** in the top right.
2. Hit **Sync All** to trigger background clones.
3. Type `danisman` or any other keyword to query instantly in **0 ms** with **0 API resource consumption**.

---

## 🛠 Architectural Decisions (Cortex Core Logs)

- **Zero DB Stack:** Storing database records as compressed `.json.gz` shards per repository under `.cache/index/` is lightweight and ultra-portable. Deleting `.cache/` is fully recoverable by triggering a Sync.
- **Port 3000 Unified Port:** Serves Express APIs on `/api/*` and uses Vite middleware in development to serve the frontend React SPA over the same 3000 port, resolving CORS or cross-origin proxy redirections instantly.
- **Self-Reflecting Turkish Fold:** To support Turkish case and character diacritic alignment, all loaded lines are pre-folded at boot time using `foldTurkish` and indexed, matching diacritics with zero CPU-latency during querying.
- **Leak shield filter:** Runs a custom scanning and masking transformer (`server/mask.ts`) across all match lines and context outputs, ensuring committed key segments are replaced with `•••MASKED•••`.

---

## 🚫 Non-goals

- Git history indexing: Searching traverses only the default HEAD branches of targets.
- Submodule checking: Zip releases from GitHub exclude Git submodule components.
- Live modification write operations: Code searches are strictly read-only.
