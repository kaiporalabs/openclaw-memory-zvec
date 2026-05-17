# @kaiporalabs/openclaw-memory-zvec

Long-term **memory plugin** for [OpenClaw](https://github.com/openclaw/openclaw) using [**Zvec**](https://github.com/alibaba/zvec) via the official Node binding [`@zvec/zvec`](https://www.npmjs.com/package/@zvec/zvec). Vectors are indexed with an **HNSW** index and **cosine** distance; recall and capture follow the usual OpenClaw memory-plugin patterns (tools + optional auto-recall / auto-capture).

**npm package:** `@kaiporalabs/openclaw-memory-zvec`  
**OpenClaw plugin id:** `memory-zvec` (see `openclaw.plugin.json`)

## Features

- **Tools:** `memory_recall`, `memory_store`, `memory_forget` (memory slot contract).
- **OpenClaw slot parity:** provides `memory_search` + `memory_get` (`path` or `relPath`), **memory flush** before compaction, **`publicArtifacts`**, and a full memory runtime so `openclaw status --all` and `openclaw memory ...` work when `plugins.slots.memory = "memory-zvec"`.
- **Markdown-first:** `memory_store` and auto-capture append to `memory/YYYY-MM-DD.md`, then index into SQLite + Zvec (same corpus as `memory_search`).
- **Embeddings:** any OpenClaw [memory embedding provider](https://docs.openclaw.ai/) — **Ollama**, **OpenAI**, Copilot, etc. Defaults are tuned for **Ollama** (`nomic-embed-text`, 768-d).
- **Storage:** local directory under `~/.openclaw/memory/zvec` by default (Zvec collection + `memory-ids.json` id list for listing).
- **CLI:** `openclaw memory-zvec list|search|stats|status|index|verify|export|import|reembed` (always under `memory-zvec`; see README for `memory` vs `memory-zvec`).
- **Retrieval:** configurable **hybrid** fusion (vector + SQLite FTS/BM25), optional **cross-encoder rerank** (Jina-compatible `/rerank`), **MMR** diversity, **adaptive recall** (skip trivial prompts), optional **time decay**, **scope** isolation (`global` + `agent:<id>` by default).
- **Status self-test:** when OpenClaw opens the memory runtime with **`purpose: "status"`** (e.g. Control UI / `doctor.memory.status`), the plugin runs path checks, SQLite/FTS stats, Zvec `count()`, and a real **embedding provider ping**; results are exposed on the manager’s `status()` payload (see below).

## Requirements

- **Node.js** ≥ 22 (matches OpenClaw).
- **OpenClaw** ≥ `2026.5.0` (peer dependency; install globally or use the project CLI you already run).
- **Zvec native builds** (from `@zvec/zvec`): **Linux** x64/ARM64, **macOS ARM64**, **Windows** x64. **macOS Intel (x64) is not supported** by upstream Zvec binaries — use ARM Mac, Linux, or Windows x64.

## OpenClaw `status` (overview vs full)

The default **`openclaw status`** command uses a **fast scan**: it does **not** open the memory subsystem or run plugin compatibility checks. That is expected OpenClaw behavior, not a bug in this plugin.

You will typically see:

| Overview line | Meaning |
| --- | --- |
| **Memory** · `enabled (plugin memory-zvec) · not checked` | Memory plugins are on and the slot is `memory-zvec`, but this run **did not probe** the store (fast mode). |
| **Plugin compatibility** · `none` | No compatibility notices were collected in this fast scan (empty list). |

To **inspect** memory stats (files/chunks/vector hints when the host resolves them) and populate **plugin compatibility** notices, run:

```bash
openclaw status --all
```

Use **`openclaw memory-zvec stats`** (or `list` / `search`) for plugin-local Zvec metrics regardless of `status` mode.

### Status probe (`purpose: "status"`)

When the host resolves the active memory plugin for **status** (not for a normal tool turn), this plugin runs **`runStatusSelfTest()`** once per manager instance. It verifies, among other things:

| Check | What it means |
| --- | --- |
| **Workspace directory** | Agent workspace exists and is readable (needed to index `MEMORY.md`, `memory/`, etc.). |
| **`sqlitePath`** | File path exists on disk when using a local path (non-local URIs are skipped with a note). |
| **`dbPath` (Zvec root)** | Directory reachable; after opening the collection, the path is re-checked (directories may be created on first use). |
| **Memory corpus roots** | Which of `MEMORY.md`, `USER.md`, `IDENTITY.md`, `memory/` are present (absence is OK if you only use tool-stored memories). |
| **Zvec collection** | `count()` succeeds (engine + on-disk schema load). |
| **SQLite / FTS** | Chunk/file stats from the open store. |
| **Embeddings** | One real request via `probeEmbeddingAvailability()` (validates provider/network/model). |

**Where to read the report:** the synchronous `status()` return value includes **`custom.memoryZvecStatusSelfTest`**, a JSON-serializable object with `overallOk`, `checkedAtMs`, per-path probes, `embedding`, `sqlite`, `zvecCollection`, `notes[]`, and `embeddingEndpointSummary` (provider/model/host only — no secrets).

**Top-level hints:** after a self-test, `vector.available` / `fts.available` and `vector.loadError` on `MemoryProviderStatus` reflect combined health (embeddings + Zvec; FTS from SQLite).

**Reliability:** `getMemorySearchManager` does **not** throw on failure; it returns `{ manager: null, error: "…" }` so the gateway status RPC does not crash if paths or native code misbehave.

## Retrieval, rerank, scopes (v1.2+)

Workspace chunks (`MEMORY.md`, `memory/`, …) are indexed with a **`scope`** column (default **`global`**). Search filters results to **`global`** plus **`agent:<agentId>`** unless you override `scopes.agentAccess`.

Hybrid scoring merges **vector ANN** with **SQLite FTS BM25** (`retrieval.mode`, weights, `minScore` / `hardMinScore`). Optional **`rerank`** calls a **Jina-style** `POST` endpoint (`{ model, query, documents:[{text}] }`). **`adaptive`** skips auto-recall / hybrid search on very short “hello/thanks” prompts unless force-keywords match. **`decay`** optionally down-weights older chunks.

Example fragment:

```json
{
  "retrieval": {
    "mode": "hybrid",
    "vectorWeight": 0.65,
    "ftsWeight": 0.35,
    "minScore": 0.2,
    "hardMinScore": 0.08,
    "mmrEnabled": true,
    "mmrLambda": 0.65,
    "mmrPoolSize": 36
  },
  "rerank": {
    "enabled": false,
    "endpoint": "https://api.jina.ai/v1/rerank",
    "model": "jina-reranker-v2-base-multilingual",
    "candidatePoolSize": 16,
    "timeoutMs": 8000,
    "rerankBlendWeight": 0.45
  },
  "autoRecallTimeoutMs": 15000
}
```

**`smartExtraction`** is parsed for forward compatibility; LLM-based extraction is not enabled in this release.

## Diagnostics & logging

Messages go through OpenClaw’s **`api.logger`** (`info`, `warn`, `error`, optional `debug`). Whether **`debug`** lines appear depends on the gateway/host log level.

This plugin also formats **`Error.cause`** chains (for example `fetch failed` from embeddings) into **`warn`** lines so failures are visible without raw `String(err)`.

### Environment variables

| Variable | When set | Effect |
| --- | --- | --- |
| **`OPENCLAW_MEMORY_ZVEC_DEBUG`** | **`1`** | Enables extra **`logger.debug`** calls (for example right before auto-recall). |
| **`DEBUG`** | contains substring **`memory-zvec`** | Same behavior as **`OPENCLAW_MEMORY_ZVEC_DEBUG=1`** (common `DEBUG` convention). |

### Examples

```bash
# Enable debug lines for this plugin (session only)
export OPENCLAW_MEMORY_ZVEC_DEBUG=1
openclaw gateway restart
```

```bash
# One-shot: run the CLI with diagnostics enabled (adjust to how you start OpenClaw)
OPENCLAW_MEMORY_ZVEC_DEBUG=1 openclaw gateway run
```

```bash
# Alternative using DEBUG (can combine with other DEBUG tokens)
DEBUG="memory-zvec" OPENCLAW_MEMORY_ZVEC_DEBUG=1 openclaw gateway run
```

**Typical `warn` sources:** auto-recall / auto-capture failures, initial workspace **`sync`** failures, vector search leg failures (plugin falls back to SQLite FTS), embedding probe failures.

## Install

### From npm (recommended)

```bash
openclaw plugins install @kaiporalabs/openclaw-memory-zvec
```

Equivalent:

```bash
npm install -g @kaiporalabs/openclaw-memory-zvec
# then register the plugin in OpenClaw config per your setup
```

### From this GitHub repository

```bash
openclaw plugins install github:kaiporalabs/openclaw-memory-zvec
```

If your installer checks out source without a prebuilt `dist/`, run `npm install && npm run build` in the clone first, or install from a release tarball that includes `dist/`.

## Publishing (maintainers)

The package is **scoped** under `@kaiporalabs`. `package.json` includes `"publishConfig": { "access": "public" }` so the first publish works as a public package:

```bash
npm login
npm publish --access public
```

More detail: [docs/PUBLISHING.md](docs/PUBLISHING.md).

## Configuration

OpenClaw reads the main config from **`~/.openclaw/openclaw.json`** (unless you override state dir). The plugin system uses:

- **`plugins.slots.memory`** — string plugin id that owns the exclusive memory slot (`"none"` disables memory plugins).
- **`plugins.entries.<pluginId>`** — per-plugin record: `enabled`, optional `hooks`, and **`config`** (plugin-specific payload).

This matches the shipped schema (`plugins.slots` + strict `plugins.entries` records). See [Gateway configuration reference — Plugins](https://docs.openclaw.ai/gateway/configuration-reference#plugins).

**Non-bundled plugins:** OpenClaw blocks conversation hooks (`agent_end`, etc.) unless you set **`plugins.entries.<id>.hooks.allowConversationAccess: true`**. This plugin uses `before_prompt_build` (auto-recall) and `agent_end` (auto-capture). Set both hook flags below so recall/capture work; if you only use tools and disable auto-capture, `allowConversationAccess` is still safe to enable.

If your config uses **`plugins.allow`** (allowlist), add **`"memory-zvec"`** to the list or the plugin will not load.

After edits, restart the gateway:

```bash
openclaw gateway restart
```

### Full example (Ollama, aligned with OpenClaw `PluginEntryConfig`)

Ensure [Ollama](https://ollama.com/) is running and the embedding model is pulled (e.g. `ollama pull nomic-embed-text`).

```json5
{
  plugins: {
    slots: {
      memory: "memory-zvec",
    },
    entries: {
      "memory-zvec": {
        enabled: true,
        hooks: {
          allowPromptInjection: true,
          allowConversationAccess: true,
        },
        config: {
          embedding: {
            provider: "ollama",
            model: "nomic-embed-text",
            baseUrl: "http://127.0.0.1:11434/v1",
          },
          autoRecall: true,
          autoCapture: true,
        },
      },
    },
  },
}
```

`nomic-embed-text` is built into the plugin’s dimension map (**768**). For other models, set **`config.embedding.dimensions`** explicitly.

### OpenAI-compatible HTTP API (explicit API key)

```json5
{
  plugins: {
    slots: {
      memory: "memory-zvec",
    },
    entries: {
      "memory-zvec": {
        enabled: true,
        hooks: {
          allowPromptInjection: true,
          allowConversationAccess: true,
        },
        config: {
          embedding: {
            provider: "openai",
            model: "text-embedding-3-small",
            apiKey: "sk-...",
          },
        },
      },
    },
  },
}
```

When `provider` is `openai` **and** `apiKey` is set under **`config.embedding`**, the plugin uses the OpenAI SDK against the default or `config.embedding.baseUrl`. For gateway-managed auth without a plugin-local key, use another provider id (e.g. `github-copilot`) and omit `apiKey`, per OpenClaw’s provider docs.

### Entry fields (`plugins.entries.memory-zvec.*`)

| Field | Description |
| --- | --- |
| `enabled` | Set `true` so the entry is active (recommended). |
| `hooks.allowPromptInjection` | Must be `true` for `before_prompt_build` / auto-recall (OpenClaw blocks prompt mutation hooks when `false`). |
| `hooks.allowConversationAccess` | **Required `true` for this npm plugin** so `agent_end` (auto-capture) is registered. |
| `config` | Plugin-specific settings (embedding, paths, autoRecall, …). |

### Plugin `config` keys (`plugins.entries.memory-zvec.config.*`)

| Key | Description |
| --- | --- |
| `embedding` | Provider/model/baseUrl/apiKey/dimensions (see `openclaw.plugin.json` / manifest). |
| `dbPath` | Data root. Default per agent: `~/.openclaw/memory/zvec/<agentId>`. Set explicitly to share one Zvec directory across agents (e.g. `~/.openclaw/memory/zvec`). **Do not set `dbPath` to `""` or whitespace**. |
| `sqlitePath` | Optional explicit SQLite path for chunk metadata + FTS. Defaults to `~/.openclaw/memory/<agentId>.sqlite`. **Empty or whitespace-only values are ignored** (defaults apply); do not set `"sqlitePath": ""` unless you intend the default. |
| `autoRecall` | Inject top memories before the model runs (default `true`). Uses indexed corpus from the last manager open/tool sync — not a full reindex every message. |
| `autoRecallTimeoutMs` | Max time for auto-recall search (default `15000`). Increase if embedding API is slow. |
| `autoCapture` | Heuristic capture from user lines after each successful turn (default `false`). |
| `captureMaxChars` / `recallMaxChars` | Length limits for capture and recall query text. |
| `dreaming` | Reserved for OpenClaw dreaming integration when this plugin owns the memory slot. |

### Troubleshooting

| Symptom | What to check |
| --- | --- |
| **`memory-zvec: dbPath resolved to empty path`** (older builds) | Remove **`dbPath: ""`** from config, or set a real path / `~/.openclaw/memory/zvec`. Current versions treat empty `dbPath` / `sqlitePath` as “use default” and fall back if `resolvePath` returns empty. |
| **`memory-zvec: dbPath missing after config resolve`** | Corrupt or missing merged config; ensure `plugins.entries["memory-zvec"].config` parses and includes valid `embedding`. |
| **After upgrade to 2.0.1+, empty search for old data** | Default Zvec path moved to `~/.openclaw/memory/zvec/<agentId>`. Either set `config.dbPath` to your old `~/.openclaw/memory/zvec` or move/copy the collection into the per-agent folder and run `memory-zvec index`. |

## CLI

Plugin-local commands (always registered under **`memory-zvec`**, no clash with bundled extensions):

```bash
openclaw memory-zvec list --limit 20 --order-by-created-at
openclaw memory-zvec search "your query" --limit 5
openclaw memory-zvec stats
openclaw memory-zvec status
openclaw memory-zvec status --agent main
```

**`memory-zvec status`** prints JSON from `MemorySearchManager.status()` after the **status self-test** (see [Status probe](#status-probe-purpose-status)), including `custom.memoryZvecStatusSelfTest` when present.

### Why not `openclaw memory status`?

OpenClaw only attaches **one** plugin CLI group per top-level command name. If **memory-core** (or another plugin) registers **`memory`** first, this plugin’s `memory status` / `memory search` handlers are **not** installed — you will still see `memory` in help, but it may be the other plugin’s implementation. Use **`openclaw memory-zvec status`** (and other `memory-zvec …` commands) for behaviour that is guaranteed to come from **memory-zvec**.

## Architecture notes

- **Zvec** stores dense **float32** embeddings under `dbPath/collection/`.
- **`memory-ids.json`** tracks document ids so `list` can call `fetchSync` (Zvec does not expose a cheap full scan in the Node API used here). If you delete this file, **list** may be empty until you re-sync manually; vector search still works for stored docs.
- Changing **embedding dimension** without a fresh store will fail with a clear error; move or delete `dbPath` to re-index.

## References

- [OpenClaw — Gateway configuration reference](https://docs.openclaw.ai/gateway/configuration-reference)
- [OpenClaw — Building plugins](https://docs.openclaw.ai/plugins/building-plugins)
- [Zvec Node binding](https://github.com/zvec-ai/zvec-node)
- [Zvec project](https://github.com/alibaba/zvec)
- [Repository](https://github.com/kaiporalabs/openclaw-memory-zvec)

## License

MIT — see [LICENSE](./LICENSE).

Zvec itself is licensed under **Apache-2.0** (see upstream notices).
