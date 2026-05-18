# Changelog

All notable changes to `@kaiporalabs/openclaw-memory-zvec` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.0] - 2026-05-18

### Added

- **`smartExtraction`:** lightweight capture normalization when enabled (trim prefixes, sentence cap).
- **`openclaw memory rem-backfill`** and **`openclaw memory-zvec rem-backfill`** — grounded backfill into `memory/.dreams/` + `DREAMS.md`, with `--rollback` / `--rollback-short-term`.

## [2.3.0] - 2026-05-18

### Changed

- **Dreaming (memory-core alignment):** writes `DREAMS.md` diary, stages candidates under `memory/.dreams/`, promotes to `MEMORY.md` only when score ≥ deep `minScore` (from OpenClaw dreaming config). Re-indexes workspace after promotion.
- `DREAMS.md` included in corpus crawl, `publicArtifacts`, and flush read-only hints.
- `memory/.dreams/` excluded from memory index crawl (STM JSON only).

## [2.2.0] - 2026-05-18

### Added

- **`memory-zvec get`** CLI command (parity with `openclaw memory get`).
- Sync summary log line (`sync complete` with file/chunk/zvec counts).

### Fixed

- **Index parity:** `sync` prunes SQLite/FTS/Zvec entries for files removed from the workspace; reconciles missing Zvec vectors after each sync.
- **`memory_get`:** reads from disk when present; falls back to indexed chunks when the file is missing (memory-core store behavior).
- **`status.dirty`:** reflects in-progress indexing during `sync`.
- Warn at startup when `smartExtraction.enabled` is set (not implemented yet).

## [2.1.0] - 2026-05-17

### Added

- **Dreaming** (`config.dreaming`): managed OpenClaw cron job, promotion of recent `memory/*.md` chunks into `MEMORY.md`, optional reports under `memory/dreaming/`. Uses Zvec/SQLite index (not memory-core recall store).
- Vitest suite and fixtures for contract, FTS, multi-agent, sync, flush, markdown-first, and dreaming.

### Changed

- Default Zvec data path is **per agent**: `~/.openclaw/memory/zvec/<agentId>` (set explicit `dbPath` to share one directory across agents).

## [2.0.1] - 2026-05-17

### Fixed

- **FTS5**: sanitize free-text queries before `MATCH` (fixes `syntax error near "info"`, `"."`, `no such column: mails`); empty token queries skip FTS leg without throwing.
- **Auto-recall**: no longer runs full `sync()` on every message (reduces 15s timeouts); index still runs on manager open and explicit reindex.
- Removed misleading startup warning when `dreaming.enabled` was set.

### Changed

- README: troubleshooting for per-agent `dbPath` migration after 2.0.1+.

## [2.0.0] - 2026-05-17

### Added

- **`memory_get`**: accepts `path` (memory-core) and `relPath` (alias).
- **Multi-agent**: `agentId` from tool/hook context (`resolvePluginAgentId`) instead of hard-coded `"main"`.
- **Auto-recall**: uses `MemorySearchManager.search()` over indexed Markdown (not global Zvec-only store).
- **`flushPlanResolver`**: pre-compaction flush plan aligned with memory-core (`memory/YYYY-MM-DD.md`).
- **`publicArtifacts`**: lists `MEMORY.md`, `USER.md`, `IDENTITY.md`, `memory/**/*.md`.
- **Markdown-first**: `memory_store` and `autoCapture` append to `memory/YYYY-MM-DD.md`, then `sync` into SQLite + Zvec.
- `memory_recall` / `memory_forget` use hybrid manager search; legacy UUID deletes still supported on Zvec.

### Changed

- Removed global `MemoryZvecStore` at plugin registration; one Zvec store per agent inside `ZvecSqliteMemoryManager`.
- **`sync()`**: short SQLite transactions per file; embeddings/Zvec writes outside the transaction (fewer `database is locked` errors).

### Removed

- Standalone Zvec-only path for slot `memory_search` / auto-recall (corpus is workspace Markdown + index).

## [1.2.2] - 2026-05

### Added

- CLI activation aliases and human-readable `memory-zvec status` output.

## [1.2.0] - 2026-05

### Added

- Hybrid retrieval: vector + SQLite FTS/BM25 fusion, optional Jina-compatible rerank, MMR, adaptive recall heuristics, optional time decay.
- Scope isolation (`global`, `agent:<id>`).
- CLI: `verify`, `export`, `import`, `reembed`.
- `memory-zvec index` for workspace reindex (`MEMORY.md`, `USER.md`, `IDENTITY.md`, `memory/`).

## [1.1.4] - 2026-05

### Fixed

- Empty `dbPath` / `sqlitePath` in config fall back to defaults instead of breaking resolution.

## [1.1.3] - 2026-05

### Added

- `memory-zvec status` CLI and docs for `memory` vs `memory-zvec` commands.

## [1.1.2] - 2026-05

### Added

- Status self-test on `getMemorySearchManager({ purpose: "status" })` (paths, SQLite, Zvec, embedding probe).

## [1.1.1] - 2026-05

### Changed

- Diagnostics via `OPENCLAW_MEMORY_ZVEC_DEBUG`; documentation cleanup.

## [1.1.0] - 2026-05

### Added

- Full memory-core replacement: `memory_search`, `memory_get`, memory runtime, `openclaw memory` CLI parity.

## [1.0.0] - 2026-05

### Added

- Initial release: Zvec ANN storage, `memory_recall` / `memory_store` / `memory_forget`, auto-recall/capture hooks, Ollama-friendly embeddings.

[2.4.0]: https://github.com/kaiporalabs/openclaw-memory-zvec/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/kaiporalabs/openclaw-memory-zvec/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/kaiporalabs/openclaw-memory-zvec/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/kaiporalabs/openclaw-memory-zvec/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/kaiporalabs/openclaw-memory-zvec/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/kaiporalabs/openclaw-memory-zvec/compare/v1.2.2...v2.0.0
[1.2.2]: https://github.com/kaiporalabs/openclaw-memory-zvec/releases/tag/v1.2.2
[1.2.0]: https://github.com/kaiporalabs/openclaw-memory-zvec/releases/tag/v1.2.0
[1.1.0]: https://github.com/kaiporalabs/openclaw-memory-zvec/releases/tag/v1.1.0
[1.0.0]: https://github.com/kaiporalabs/openclaw-memory-zvec/releases/tag/v1.0.0
