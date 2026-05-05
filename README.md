# @kaiporalabs/openclaw-memory-zvec

Long-term **memory plugin** for [OpenClaw](https://github.com/openclaw/openclaw) using [**Zvec**](https://github.com/alibaba/zvec) via the official Node binding [`@zvec/zvec`](https://www.npmjs.com/package/@zvec/zvec). Vectors are indexed with an **HNSW** index and **cosine** distance; recall and capture behave like the bundled LanceDB memory plugin (tools + optional auto-recall / auto-capture).

**npm package:** `@kaiporalabs/openclaw-memory-zvec`  
**OpenClaw plugin id:** `memory-zvec` (see `openclaw.plugin.json`)

## Features

- **Tools:** `memory_recall`, `memory_store`, `memory_forget` (memory slot contract).
- **OpenClaw slot parity:** provides `memory_search` + `memory_get`, and registers a full memory runtime capability so `openclaw status --all` and `openclaw memory ...` work when `plugins.slots.memory = "memory-zvec"`.
- **Embeddings:** any OpenClaw [memory embedding provider](https://docs.openclaw.ai/) — **Ollama**, **OpenAI**, Copilot, etc. Defaults are tuned for **Ollama** (`nomic-embed-text`, 768-d).
- **Storage:** local directory under `~/.openclaw/memory/zvec` by default (Zvec collection + `memory-ids.json` id list for listing).
- **CLI:** `openclaw memory-zvec list|search|stats` (after the plugin is loaded).

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

This matches the shipped schema (`plugins.slots` + strict `plugins.entries` records). See [Gateway configuration reference — Plugins](https://docs.openclaw.ai/gateway/configuration-reference#plugins) and [Memory LanceDB](https://docs.openclaw.ai/plugins/memory-lancedb) for the same entry layout with another memory plugin.

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
          autoCapture: false,
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
| `dbPath` | Data root (default `~/.openclaw/memory/zvec`). Holds the Zvec collection directory and `memory-ids.json`. |
| `sqlitePath` | Optional explicit SQLite path for chunk metadata + FTS. Defaults to `~/.openclaw/memory/<agentId>.sqlite` to align with builtin store paths. |
| `autoRecall` | Inject top memories before the model runs (default `true`). |
| `autoCapture` | Heuristic capture from user lines after each successful turn (default `false`). |
| `captureMaxChars` / `recallMaxChars` | Length limits for capture and recall query text. |
| `dreaming` | Reserved for OpenClaw dreaming integration when this plugin owns the memory slot. |

## CLI

```bash
openclaw memory-zvec list --limit 20 --order-by-created-at
openclaw memory-zvec search "your query" --limit 5
openclaw memory-zvec stats
```

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
