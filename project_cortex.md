# PROJECT CORTEX: SYSTEM LOG & PRINCIPLES

## STATUS: INITIALIZATION
- **Date:** 2026-06-12 (Updated)
- **Role:** Genesis Quantum Architect
- **Goal:** Robust, Zero-Dependency Code Base Indexer with Active Telemetry for MacBook M4 Pro Max
- **Current Phase:** Alpha (Telemetry Tracker Enabled successfully)

## WORKING PRINCIPLES (DATABASE)
1.  **Zero Dependency Core:** No bulky standard SQLite or Redis, index stores compressed in disk `.json.gz` shards.
2.  **Turkish Locale Fold (TR Fold):** All matching characters folded beforehand at loading stage once to bypass live diacritics CPU latency overhead.
3.  **Active Telemetry & Trace Auditor:** Active search logging with dynamic CPU performance metrics, profiling, RAM heaps metrics representation.
4.  **Leak Guard Security Watchdog:** Scrub credentials or PAT keys from source logs by live scrubbing matching `ghp_` patterns.

## EXECUTION LOG & COMMITS
- [x] Initial full-stack client-server SPA layout established.
- [x] Pre-compiled Turkic language folding logic optimized.
- [x] Search query logs persistent history trace implemented (`/api/history`, `/api/history/clear`).
- [x] High-fidelity MacBook M4 Pro Max (16-Core virtual thread) system telemetry endpoint (`/api/telemetry`) established.
- [x] Front-end drawer modal `TelemetryDrawer` with CPU thread-load visualizations and selectable query log lists mounted.
- [x] Complete system verification and linter diagnostics passed.
