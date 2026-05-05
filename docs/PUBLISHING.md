# Publishing `@kaiporalabs/openclaw-memory-zvec`

## Package identity

| Item | Value |
| --- | --- |
| **npm name** | `@kaiporalabs/openclaw-memory-zvec` |
| **OpenClaw plugin id** | `memory-zvec` (unchanged; used in `plugins.entries` and `plugins.slots`) |
| **GitHub** | [kaiporalabs/openclaw-memory-zvec](https://github.com/kaiporalabs/openclaw-memory-zvec) |

The scoped name is only for installation (`openclaw plugins install @kaiporalabs/openclaw-memory-zvec`). Config keys still use the plugin id **`memory-zvec`**.

## Steps

1. Bump `version` in `package.json` (semver).
2. `npm run build` (also runs on `prepublishOnly`).
3. `npm login` (org **kaiporalabs** must allow your user to publish).
4. `npm publish --access public`  
   `publishConfig.access` is already `"public"` in `package.json`.

## Post-publish

Users install with:

```bash
openclaw plugins install @kaiporalabs/openclaw-memory-zvec
```

They must add a **`plugins.entries.memory-zvec`** block with nested **`config`** (and hook flags for non-bundled plugins). See the [README configuration section](../README.md#configuration).

## Diagnostics

Environment variables for verbose plugin diagnostics (`OPENCLAW_MEMORY_ZVEC_DEBUG`, `DEBUG`) are documented in the [README](../README.md#diagnostics--logging).
