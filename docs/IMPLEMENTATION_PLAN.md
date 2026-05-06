# Roadmap / implementation status

This document tracks the **memory-zvec “full parity”** plan versus what shipped in-tree.

## Shipped in **v1.2.0**

- Config: `retrieval`, `rerank`, `adaptive`, `decay`, `scopes`, `smartExtraction` (parsed only), `autoRecallTimeoutMs`.
- Hybrid fusion (vector + FTS BM25 normalization), optional rerank (Jina-compatible HTTP), MMR diversity (text overlap), adaptive recall heuristics, optional time decay on chunk age.
- SQLite migration: `memory_chunks.scope`; sync writes `scopes.defaultMemoryScope`.
- Path validation for Zvec data root (`path-validation.ts`).
- CLI: `memory-zvec verify`, `export`, `import`, `reembed` (plus existing `index`).
- Auto-recall: respects `autoRecallTimeoutMs` + adaptive skip.

## Planned / not implemented here

- LLM **smart extraction** pipeline (capture classification, merge/skip graph).
- Full **lifecycle tiers** (Core/Working/Peripheral) with metadata write-back beyond simple decay.
- Advanced **session memory** strategies mirroring other plugins.
- Automated **tests** in CI (Vitest) — add next.

## Ops

- Backup: `openclaw memory-zvec export -o backup.json`
- Restore vectors: `openclaw memory-zvec import -i backup.json` then optionally `reembed` if embeddings model changed.
