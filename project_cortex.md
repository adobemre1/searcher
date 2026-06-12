# PROJECT CORTEX: SYSTEM LOG & PRINCIPLES

## STATUS: INITIALIZATION
- **Date:** 2026-06-12 (Updated)
- **Role:** Genesis Quantum Architect
- **Goal:** Robust, Zero-Dependency Code Base Indexer with Active Telemetry for MacBook M4 Pro Max & Quantum Math Library
- **Current Phase:** MVP (Milestone 0: Stop-the-bleed + Hijyen + Tripwire successfully closed)

## WORKING PRINCIPLES (DATABASE)
1.  **Zero Dependency Core:** No bulky standard SQLite or Redis, index stores compressed in disk `.json.gz` shards.
2.  **Quantum Mathematics Core (Python & TS):** Developed mathematically rigorous, zero-dependency engine performing multi-core vector, matrix, and statistics optimization (Sigmoid, Shannon Entropy, Cosine Vector Similarity).
3.  **Turkish Locale Fold (TR Fold):** All matching characters folded beforehand at loading stage once to bypass live diacritics CPU latency overhead.
4.  **Active Telemetry & Trace Auditor:** Active search logging with dynamic CPU performance metrics, profiling, RAM heaps metrics representation.
5.  **Leak Guard Security Watchdog:** Scrub credentials or PAT keys from source logs by live scrubbing matching `ghp_` patterns.

## EXECUTION LOG & COMMITS
- [x] Initial full-stack client-server SPA layout established.
- [x] Pre-compiled Turkic language folding logic optimized.
- [x] Search query logs persistent history trace implemented (`/api/history`, `/api/history/clear`).
- [x] High-fidelity MacBook M4 Pro Max (16-Core virtual thread) system telemetry endpoint (`/api/telemetry`) established.
- [x] Front-end drawer modal `TelemetryDrawer` with CPU thread-load visualizations and selectable query log lists mounted.
- [x] Complete system verification and linter diagnostics passed.
- [x] **Milestone 0 (P0): Stop-the-bleed + Hijyen + Tripwire Completed:**
  - **Quantum Math Library:** Generated Python package ready for PyPI publishing (`pyproject.toml`, `src/quantum_core/engine.py`, `src/quantum_core/__init__.py`, `tests/test_engine.py`, and CI/CD `.github/workflows/quantum_deploy.yml`).
  - **Node.js Integration:** Ported `QuantumEngine` directly inside `/server/quantumEngine.ts` to execute zero-overhead Shannon Entropy calculations over query distribution in active telemetry.
  - **E2E Watchdog Tripwire:** Mounted Python Package validation code inside Node's `/api/doctor` diagnostic checks, linking package integrity tests directly into the UI dashboard diagnostics.
  - **Hygiene (Hijyen):** Documented GitHub personal access keys (PATs) properly inside `.env.example`.

## ROADMAP & E2E PROGRESSION (TODO LIST)

### PHASE 1: QUANTUM SEMANTIC CODE SEARCH ENGINE (AI + OFFLINE TF-IDF CODESIG CORES)
- [x] Create `/api/search` expansion incorporating **Semantic Search Mode** (`mode: 'semantic'`).
- [x] Implement dual-engine resolver in `/server/semanticSearch.ts`:
  - **AI Engine (Gemini SDK)**: If `process.env.GEMINI_API_KEY` is available, utilize `gemini-3.5-flash` to embed or semantic-match code queries against codebase index caches.
  - **Offline Fallback (Quantum TF-IDF Cosine Similarity)**: If API key is missing, utilize `/server/quantumEngine.ts` to construct lightweight term frequency (TF-IDF) vectors from folded line fragments, scoring documents using cosine similarity.
- [x] Build interactive Semantic search option in front-end `SearchBar.tsx` and map incoming results with similarity scores.

### PHASE 2: MACBOOK M4 PRO MAX 16-CORE WORKLOAD PARALLELIZER
- [x] Define custom virtual thread-pool engine in `/server/history.ts` simulating MacBook M4 Pro Max (16 cores - 12 Performance, 4 Efficiency).
- [x] Map active index search files across virtual core batches; during search, calculate dynamic core load percent profiles and execution clock times.
- [x] Integrate core load traces dynamically into `/api/telemetry` response based on active index read load with thermodynamic cooling formulas.

### PHASE 3: COMPACT SYNTAX AST TOKENIZER & SNIPPET VISUALIZER
- [x] Build a zero-dependency codebase tokenizer in `/src/components/ResultItem.tsx` to detect syntactic tokens (keywords, comments, brackets, strings) on matched code lines.
- [x] Enhance `/src/components/ResultList.tsx` to display micro-highlighted syntactic elements on files, supporting beautiful line markers and file expansion.

### PHASE 4: DIAGNOSTIC MONITOR & INTEGRITY TRIPWIRES
- [x] Update `/api/doctor` to run Quantum Mathematical Core load tests and Sandbox stability checks (Checks 7 & 8).
- [x] Bind new dynamic diagnostic reporting panels in the front-end `DoctorModal` with automated optimization triggers.

### PHASE 5: REVOLUTIONARY BOOLEAN QUERY WITH NEGATIVE TERM EXCLUSION
- [x] Add negative word exclusion filters (`-skipKeyword`) to `searchMirror` and `executeLocalSemanticSearch`.
- [x] Implement support for exact string match boundaries inside double quotes (`"exact phrase"`).

### PHASE 6: SELECTIVE SHARD PURGE ENGINE
- [x] Create `/api/repos/delete` endpoint to clean specific cached `.json.gz` files from disk storage.
- [x] Add selective delete button in repository cards inside `SyncPanel.tsx`.

### PHASE 7: STYLIZED TELEMETRY EXPORTER
- [x] Mount a dynamic export button in `TelemetryDrawer` connecting to `/api/telemetry/export`.
- [x] Deliver formatted JSON report download on click with Shannon Entropy values and core-loads data.

### PHASE 8: CROSS-ENGINE MATHEMATICAL CALIBRATION & BENCHMARK SUITE
- [x] Create `/api/benchmark` endpoint running 1,000 multi-iterations of 15x15 Matrix Multiplication and Shannon Entropy.
- [x] Integrate dual-engine clock measurements comparing Node (TypeScript) V8 execution against Python 3 VM shell environments.
- [x] Verify mathematical precision parity between JS float implementation and Python floats.
- [x] Mount the "Quantum Benchmark" tab in the `TelemetryDrawer` displaying visual comparison cards, calibration specs, and system performance recommendations.

### PHASE 9: GOOGLE-GRADE BM25 CALIBRATION & RELEVANCE ENHANCER
- [x] Implement enhanced TF-IDF algorithm incorporating complete BM25 term frequency saturation (with adjustable `k1` and `b` inputs).
- [x] Implement common codebase programming noise/stopword filter logic to block unhelpful index matching of basic terms like "const", "import", "class", etc.
- [x] Add line-length guard thresholds to avoid processing minified rows, dramatically improving file-scanning pipeline execution times.

### PHASE 10: INTERACTIVE CALIBRATION CONTROLS PANEL & DYNAMIC TUNING
- [x] Mount an "Engine Calibration Slider UI" block at the bottom of the sidebar `Filters.tsx` component.
- [x] Support visual parameter tuning for: Similarity Threshold, Path Boost, BM25 saturation `k1`/`b`, and max scanned line length limits.
- [x] Store chosen settings persistently inside browser `localStorage` and map them dynamically into all `/api/search` queries.
- [x] Bind real-time system performance impact indicators to visually represent math calculations alignment.

