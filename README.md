# openclaw-memory-zvec

Long-term **memory plugin** for [OpenClaw](https://github.com/openclaw/openclaw) using [**Zvec**](https://github.com/alibaba/zvec) via the official Node binding [`@zvec/zvec`](https://www.npmjs.com/package/@zvec/zvec). Vectors are indexed with an **HNSW** index and **cosine** distance; recall and capture behave like the bundled LanceDB memory plugin (tools + optional auto-recall / auto-capture).

## Features

- **Tools:** `memory_recall`, `memory_store`, `memory_forget` (memory slot contract).
- **Embeddings:** any OpenClaw [memory embedding provider](https://docs.openclaw.ai/) — **Ollama**, **OpenAI**, Copilot, etc. Defaults are tuned for **Ollama** (`nomic-embed-text`, 768-d).
- **Storage:** local directory under `~/.openclaw/memory/zvec` by default (Zvec collection + `memory-ids.json` id list for listing).
- **CLI:** `openclaw memory-zvec list|search|stats` (after the plugin is loaded).

## Requirements

- **Node.js** ≥ 22 (matches OpenClaw).
- **OpenClaw** ≥ `2026.5.0` (peer dependency; install globally or use the project CLI you already run).
- **Zvec native builds** (from `@zvec/zvec`): **Linux** x64/ARM64, **macOS ARM64**, **Windows** x64. **macOS Intel (x64) is not supported** by upstream Zvec binaries — use ARM Mac, Linux, or Windows x64.

## Install

### From npm (when published)

```bash
openclaw plugins install openclaw-memory-zvec
```

### From this GitHub repository

```bash
openclaw plugins install github:kaiporalabs/openclaw-memory-zvec
```

If your installer checks out source without a prebuilt `dist/`, run `npm install && npm run build` in the clone first, or install from a release tarball that includes `dist/`.

## Configuration

1. Select the plugin for the **memory** slot (exact config keys follow your OpenClaw version; see [Building plugins](https://docs.openclaw.ai/plugins/building-plugins)).
2. Add plugin config under the entry id **`memory-zvec`** (must match `openclaw.plugin.json`).

### Minimal Ollama example

Ensure [Ollama](https://ollama.com/) is running and the embedding model is pulled (e.g. `ollama pull nomic-embed-text`).

```json5
{
  plugins: {
    slots: {
      memory: "memory-zvec",
    },
    entries: {
      "memory-zvec": {
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

`nomic-embed-text` is built into the plugin’s dimension map (**768**). For other models, set **`embedding.dimensions`** explicitly.

### OpenAI-compatible HTTP API (explicit API key)

```json5
{
  plugins: {
    entries: {
      "memory-zvec": {
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

When `provider` is `openai` **and** `apiKey` is set in plugin config, the plugin uses the OpenAI SDK against the default or `embedding.baseUrl` endpoint. For gateway-managed auth without a plugin-local key, use another provider id (e.g. `github-copilot`) or rely on the adapter’s normal config as documented for your OpenClaw setup.

### Optional keys

| Key | Description |
| --- | --- |
| `dbPath` | Data root (default `~/.openclaw/memory/zvec`). Holds the Zvec collection directory and `memory-ids.json`. |
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

- [OpenClaw — Building plugins](https://docs.openclaw.ai/plugins/building-plugins)
- [Zvec Node binding](https://github.com/zvec-ai/zvec-node)
- [Zvec project](https://github.com/alibaba/zvec)

## License

MIT — see [LICENSE](./LICENSE).

Zvec itself is licensed under **Apache-2.0** (see upstream notices).
