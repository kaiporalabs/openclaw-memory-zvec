import fsp from "node:fs/promises";
import path from "node:path";
/**
 * OpenClaw Memory (Zvec) — long-term memory with local ANN via `@zvec/zvec`.
 *
 * **Logging:** uses `api.logger` (`info`/`warn`/`debug`). Verbose debug lines require
 * `OPENCLAW_MEMORY_ZVEC_DEBUG=1` or `DEBUG` containing `memory-zvec` — see `debug-env.ts` and the
 * README section “Diagnostics & logging”.
 *
 * **Errors:** hooks use `formatErrorDiagnostic` so embedding/network failures are not truncated to
 * `String(err)`.
 */
import { Type } from "typebox";
import { resolveLivePluginConfigObject } from "openclaw/plugin-sdk/plugin-config-runtime";
import { definePluginEntry, } from "openclaw/plugin-sdk/plugin-entry";
import { resolvePluginAgentId } from "./agent-context.js";
import { buildMemoryZvecFlushPlan } from "./flush-plan.js";
import { appendMemoryNote } from "./markdown-memory.js";
import { resolveMemoryGetRelPath } from "./memory-get-params.js";
import { defaultZvecDataRootFromCfg, listMemoryZvecPublicArtifacts, } from "./public-artifacts.js";
import { registerMemoryZvecDreaming } from "./dreaming/register.js";
import { createEmbeddings } from "./embeddings.js";
import { memoryConfigSchema, resolveDefaultDbPath, resolveDefaultSqlitePath, vectorDimsForModel, MEMORY_CATEGORIES, } from "./config.js";
import { shouldSkipAdaptiveRecall } from "./adaptive-retrieval.js";
import { DEFAULT_AUTO_RECALL_TIMEOUT_MS, extractLatestUserText, extractUserTextContent, formatRelevantMemoriesContext, messageFingerprint, normalizeRecallQuery, resolveAutoCaptureStartIndex, shouldCapture, detectCategory, } from "./runtime-helpers.js";
import { MemoryZvecStore } from "./zvec-store.js";
import { ZvecSqliteMemoryManager } from "./memory-manager.js";
import { describeEmbeddingEndpoint, formatErrorDiagnostic } from "./error-diagnostic.js";
import { formatMemoryStatusCliOutput } from "./format-memory-status-cli.js";
import { isMemoryZvecDebug } from "./debug-env.js";
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
async function runWithTimeout(params) {
    let timeout;
    const TIMEOUT = Symbol("timeout");
    const timeoutPromise = new Promise((resolve) => {
        timeout = setTimeout(() => resolve(TIMEOUT), params.timeoutMs);
        timeout.unref?.();
    });
    const taskPromise = params.task();
    taskPromise.catch(() => undefined);
    try {
        const result = await Promise.race([taskPromise, timeoutPromise]);
        if (result === TIMEOUT) {
            return { status: "timeout" };
        }
        return { status: "ok", value: result };
    }
    finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}
function parsePositiveIntegerOption(value, flag) {
    if (value === undefined) {
        return undefined;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`${flag} must be a positive integer`);
    }
    return parsed;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * `api.resolvePath` is typed as `string` but some runtimes return `undefined` or `""`.
 * Produces a usable path for `path.dirname` / SQLite (never `undefined`).
 */
function coerceFilesystemPathForPlugin(api, raw, defaultRaw) {
    const trimmed = raw.trim();
    const source = trimmed.length > 0 ? raw : defaultRaw;
    const sourceTrim = source.trim();
    if (!sourceTrim) {
        return path.resolve(defaultRaw.trim());
    }
    if (sourceTrim.includes("://")) {
        return sourceTrim;
    }
    let resolved = api.resolvePath(source);
    if (typeof resolved === "string" && resolved.trim().length > 0) {
        return resolved;
    }
    if (path.isAbsolute(sourceTrim)) {
        return path.resolve(sourceTrim);
    }
    resolved = api.resolvePath(defaultRaw);
    if (typeof resolved === "string" && resolved.trim().length > 0) {
        return resolved;
    }
    const defTrim = defaultRaw.trim();
    if (path.isAbsolute(defTrim)) {
        return path.resolve(defTrim);
    }
    return path.resolve(sourceTrim);
}
/**
 * Resolve the Zvec data directory for `getMemorySearchManager` (status/CLI/doctor).
 * Replays registration-time resolution, then tolerates `api.resolvePath` returning empty (CLI/sandbox edge cases).
 */
function resolveZvecRootForMemoryManager(params) {
    const trimmed = params.rawDb.trim();
    if (!trimmed) {
        return coerceFilesystemPathForPlugin(params.api, params.rawDb, resolveDefaultDbPath());
    }
    if (trimmed.includes("://")) {
        return trimmed;
    }
    let resolved = params.api.resolvePath(params.rawDb);
    if (typeof resolved === "string" && resolved.trim().length > 0) {
        return resolved;
    }
    if (path.isAbsolute(trimmed)) {
        return path.resolve(trimmed);
    }
    const fromDefault = params.api.resolvePath(resolveDefaultDbPath());
    if (typeof fromDefault === "string" && fromDefault.trim().length > 0) {
        return fromDefault;
    }
    const defaultRaw = resolveDefaultDbPath();
    if (path.isAbsolute(defaultRaw)) {
        return path.resolve(defaultRaw);
    }
    if (trimmed === params.registrationDbPath.trim()) {
        const root = params.registrationResolvedRoot.trim();
        if (root.length > 0) {
            return root;
        }
    }
    return coerceFilesystemPathForPlugin(params.api, params.rawDb, resolveDefaultDbPath());
}
export default definePluginEntry({
    id: "memory-zvec",
    name: "Memory (Zvec)",
    description: "Zvec-backed long-term memory with auto-recall/capture (Ollama-friendly embeddings)",
    kind: "memory",
    configSchema: memoryConfigSchema,
    register(api) {
        let cfg;
        const registrationPluginConfig = api.pluginConfig;
        const userSetSqlitePathAtRegistration = typeof registrationPluginConfig.sqlitePath === "string" &&
            registrationPluginConfig.sqlitePath.trim().length > 0;
        const userSetDbPathAtRegistration = typeof registrationPluginConfig.dbPath === "string" &&
            registrationPluginConfig.dbPath.trim().length > 0;
        try {
            cfg = memoryConfigSchema.parse(api.pluginConfig, { agentId: "main" });
        }
        catch (error) {
            api.registerService({
                id: "memory-zvec",
                start: () => {
                    const message = error instanceof Error ? error.message : String(error);
                    api.logger.warn(`memory-zvec: disabled until configured (${message})`);
                },
            });
            return;
        }
        const dbPath = cfg.dbPath;
        const resolvedDataRoot = dbPath.includes("://") ? dbPath : api.resolvePath(dbPath);
        const vectorDim = typeof cfg.embedding.dimensions === "number"
            ? cfg.embedding.dimensions
            : vectorDimsForModel(cfg.embedding.model);
        const disabledHookCfg = { ...cfg, autoCapture: false, autoRecall: false };
        const autoCaptureCursors = new Map();
        const getRuntimeCfg = () => (api.runtime.config?.current?.() ?? api.config);
        const resolveToolAgentId = (ctx) => resolvePluginAgentId({
            agentId: ctx.agentId,
            sessionKey: ctx.sessionKey,
            cfg: getRuntimeCfg(),
        });
        const resolveHookAgentId = (ctx) => resolvePluginAgentId({
            agentId: ctx.agentId,
            sessionKey: ctx.sessionKey,
            cfg: getRuntimeCfg(),
        });
        const resolveCurrentHookConfig = (agentId) => {
            const runtimePluginConfig = resolveLivePluginConfigObject(api.runtime.config?.current
                ? () => api.runtime.config.current()
                : undefined, "memory-zvec", api.pluginConfig);
            if (!runtimePluginConfig) {
                return disabledHookCfg;
            }
            return memoryConfigSchema.parse({
                embedding: {
                    provider: cfg.embedding.provider,
                    apiKey: cfg.embedding.apiKey,
                    model: cfg.embedding.model,
                    ...(cfg.embedding.baseUrl ? { baseUrl: cfg.embedding.baseUrl } : {}),
                    ...(typeof cfg.embedding.dimensions === "number"
                        ? { dimensions: cfg.embedding.dimensions }
                        : {}),
                    ...asRecord(asRecord(runtimePluginConfig)?.embedding),
                },
                ...(cfg.dreaming ? { dreaming: cfg.dreaming } : {}),
                ...(userSetDbPathAtRegistration ? { dbPath: cfg.dbPath } : {}),
                // Do not inject schema-default sqlitePath from registration (main.sqlite) for every
                // agent; omit so re-parse uses resolveDefaultSqlitePath(agentId). Only pass through when
                // the user set sqlitePath in plugin config, or when live config sets it (spread below).
                ...(userSetSqlitePathAtRegistration ? { sqlitePath: cfg.sqlitePath } : {}),
                autoCapture: cfg.autoCapture,
                autoRecall: cfg.autoRecall,
                captureMaxChars: cfg.captureMaxChars,
                recallMaxChars: cfg.recallMaxChars,
                ...asRecord(runtimePluginConfig),
            }, { agentId });
        };
        api.logger.info(`memory-zvec: registered (data: ${resolvedDataRoot}, dim=${vectorDim}, lazy Zvec init)`);
        if (cfg.smartExtraction.enabled) {
            api.logger.warn("memory-zvec: smartExtraction.enabled is not implemented yet; auto-capture uses heuristic rules only (memory-core parity pending).");
        }
        // Register full memory capability so OpenClaw status/CLI/tools can resolve the active memory runtime.
        // getMemorySearchManager must not throw: gateway `doctor.memory.status` has no outer catch.
        const memoryRuntime = {
            async getMemorySearchManager(params) {
                try {
                    const agentId = params.agentId ?? "main";
                    const baseCfg = (api.runtime.config?.current?.() ?? api.config);
                    const effectiveCfg = resolveCurrentHookConfig(agentId);
                    const rawSqlite = typeof effectiveCfg.sqlitePath === "string" && effectiveCfg.sqlitePath.trim().length > 0
                        ? effectiveCfg.sqlitePath
                        : resolveDefaultSqlitePath(agentId);
                    const resolvedSqlitePath = coerceFilesystemPathForPlugin(api, rawSqlite, resolveDefaultSqlitePath(agentId));
                    const rawDb = typeof effectiveCfg.dbPath === "string" && effectiveCfg.dbPath.trim().length > 0
                        ? effectiveCfg.dbPath
                        : undefined;
                    if (!rawDb) {
                        return {
                            manager: null,
                            error: "memory-zvec: dbPath missing after config resolve",
                        };
                    }
                    const resolvedZvecRoot = resolveZvecRootForMemoryManager({
                        rawDb,
                        api,
                        registrationDbPath: dbPath,
                        registrationResolvedRoot: resolvedDataRoot,
                    });
                    if (!resolvedZvecRoot.trim()) {
                        return {
                            manager: null,
                            error: "memory-zvec: dbPath resolved to empty path (check plugins.entries.memory-zvec.config.dbPath is non-empty or unset; avoid dbPath: \"\")",
                        };
                    }
                    const workspaceDirRaw = api.runtime.agent.resolveAgentWorkspaceDir(baseCfg, agentId);
                    const workspaceDir = typeof workspaceDirRaw === "string" && workspaceDirRaw.trim().length > 0
                        ? workspaceDirRaw
                        : path.resolve(process.cwd());
                    const manager = new ZvecSqliteMemoryManager({ ...effectiveCfg, sqlitePath: resolvedSqlitePath, dbPath: resolvedZvecRoot }, workspaceDir, agentId, createEmbeddings(api, effectiveCfg), new MemoryZvecStore(resolvedZvecRoot, vectorDim), api.logger);
                    if (params.purpose === "status") {
                        await manager.runStatusSelfTest().catch((probeErr) => {
                            api.logger.warn(`memory-zvec: runStatusSelfTest failed: ${formatErrorDiagnostic(probeErr)}`);
                        });
                    }
                    else {
                        await manager
                            .sync({ reason: params.purpose ?? "open", force: false })
                            .catch(() => undefined);
                    }
                    return { manager };
                }
                catch (err) {
                    const diagnostic = formatErrorDiagnostic(err);
                    api.logger.warn(`memory-zvec: getMemorySearchManager failed: ${diagnostic}`);
                    return {
                        manager: null,
                        error: `memory-zvec: ${diagnostic}`,
                    };
                }
            },
            resolveMemoryBackendConfig() {
                return { backend: "builtin" };
            },
            async closeAllMemorySearchManagers() {
                // Managers are ephemeral; nothing global to close.
            },
        };
        const promptBuilder = () => {
            return [
                "Use memory_search to find relevant notes from MEMORY.md and memory/.",
                "Use memory_get to open a specific result by path and line range.",
            ];
        };
        const withMemoryManager = async (agentId, sessionKey, purpose, fn) => {
            const { manager, error } = await memoryRuntime.getMemorySearchManager({
                cfg: getRuntimeCfg(),
                agentId,
                purpose,
            });
            if (!manager) {
                return { ok: false, error: error ?? "memory manager unavailable" };
            }
            try {
                const value = await fn(manager);
                return { ok: true, value };
            }
            finally {
                await manager.close?.().catch(() => undefined);
            }
        };
        registerMemoryZvecDreaming(api, {
            memoryRuntime,
            getRuntimeCfg,
        });
        api.registerMemoryCapability({
            runtime: memoryRuntime,
            promptBuilder,
            flushPlanResolver: buildMemoryZvecFlushPlan,
            publicArtifacts: {
                listArtifacts: async (params) => listMemoryZvecPublicArtifacts({
                    cfg: params.cfg,
                    resolveWorkspaceDir: (agentId) => {
                        const dir = api.runtime.agent.resolveAgentWorkspaceDir(params.cfg, agentId);
                        return typeof dir === "string" && dir.trim().length > 0 ? dir : undefined;
                    },
                    resolveZvecDataRoot: () => {
                        const raw = defaultZvecDataRootFromCfg(params.cfg);
                        if (!raw) {
                            return resolvedDataRoot;
                        }
                        return raw.includes("://") ? raw : api.resolvePath(raw);
                    },
                }),
            },
        });
        api.registerTool((ctx) => ({
            name: "memory_recall",
            label: "Memory Recall",
            description: "Search workspace memory (hybrid vector + keyword). Alias for memory_search over MEMORY.md and memory/.",
            parameters: Type.Object({
                query: Type.String({ description: "Search query" }),
                limit: Type.Optional(Type.Number({ description: "Max results (default: 5)" })),
            }),
            async execute(_toolCallId, params) {
                const { query, limit = 5 } = params;
                const agentId = resolveToolAgentId(ctx);
                const run = await withMemoryManager(agentId, ctx.sessionKey, "default", async (manager) => {
                    return manager.search(query, { maxResults: limit, minScore: 0.1 });
                });
                if (!run.ok) {
                    throw new Error(run.error);
                }
                const results = run.value;
                if (results.length === 0) {
                    return {
                        content: [{ type: "text", text: "No relevant memories found." }],
                        details: { count: 0 },
                    };
                }
                const text = results
                    .map((r, i) => `${i + 1}. ${r.path}:${r.startLine}-${r.endLine} (${(r.score * 100).toFixed(0)}%)\n${r.snippet}`)
                    .join("\n\n");
                return {
                    content: [{ type: "text", text: `Found ${results.length} memories:\n\n${text}` }],
                    details: { count: results.length, results },
                };
            },
        }), { name: "memory_recall" });
        api.registerTool((ctx) => ({
            name: "memory_store",
            label: "Memory Store",
            description: "Persist important information in workspace memory (appends to memory/YYYY-MM-DD.md and indexes).",
            parameters: Type.Object({
                text: Type.String({ description: "Information to remember" }),
                importance: Type.Optional(Type.Number({ description: "Importance 0-1 (default: 0.7)" })),
                category: Type.Optional(Type.Unsafe({
                    type: "string",
                    enum: [...MEMORY_CATEGORIES],
                })),
            }),
            async execute(_toolCallId, params) {
                const { text, category = "other", } = params;
                void params;
                const agentId = resolveToolAgentId(ctx);
                const baseCfg = getRuntimeCfg();
                const run = await withMemoryManager(agentId, ctx.sessionKey, "default", async (manager) => {
                    const dupes = await manager.search(text, { maxResults: 1, minScore: 0.95 });
                    if (dupes.length > 0) {
                        return {
                            action: "duplicate",
                            existingText: dupes[0].snippet,
                            relPath: dupes[0].path,
                        };
                    }
                    const written = await appendMemoryNote({
                        workspaceDir: manager.getWorkspaceDir(),
                        text,
                        category,
                        cfg: baseCfg,
                    });
                    await manager.sync?.({ reason: "memory_store", force: false });
                    return { action: "created", relPath: written.relPath };
                });
                if (!run.ok) {
                    throw new Error(run.error);
                }
                const result = run.value;
                if (result.action === "duplicate") {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Similar memory already exists: "${result.existingText}"`,
                            },
                        ],
                        details: { action: "duplicate", existingText: result.existingText, path: result.relPath },
                    };
                }
                return {
                    content: [{ type: "text", text: `Stored in ${result.relPath}: "${text.slice(0, 100)}..."` }],
                    details: { action: "created", path: result.relPath },
                };
            },
        }), { name: "memory_store" });
        api.registerTool((ctx) => ({
            name: "memory_forget",
            label: "Memory Forget",
            description: "Delete indexed memory chunks by id or semantic match.",
            parameters: Type.Object({
                query: Type.Optional(Type.String({ description: "Search to find memory" })),
                memoryId: Type.Optional(Type.String({ description: "Specific chunk or legacy memory ID" })),
            }),
            async execute(_toolCallId, params) {
                const { query, memoryId } = params;
                const agentId = resolveToolAgentId(ctx);
                if (memoryId) {
                    const run = await withMemoryManager(agentId, ctx.sessionKey, "default", async (manager) => {
                        const deleted = await manager.forgetById(memoryId);
                        if (deleted) {
                            return { action: "deleted", id: memoryId };
                        }
                        if (UUID_RE.test(memoryId)) {
                            const legacy = await manager.forgetLegacyVectorId(memoryId);
                            if (legacy) {
                                return { action: "deleted_legacy", id: memoryId };
                            }
                        }
                        return { action: "not_found" };
                    });
                    if (!run.ok) {
                        throw new Error(run.error);
                    }
                    if (run.value.action === "not_found") {
                        return {
                            content: [{ type: "text", text: `No memory found for id ${memoryId}.` }],
                            details: { action: "not_found", id: memoryId },
                        };
                    }
                    return {
                        content: [{ type: "text", text: `Memory ${memoryId} forgotten.` }],
                        details: { action: "deleted", id: memoryId },
                    };
                }
                if (query) {
                    const run = await withMemoryManager(agentId, ctx.sessionKey, "default", async (manager) => manager.forgetByQuery(query, 0.7));
                    if (!run.ok) {
                        throw new Error(run.error);
                    }
                    const result = run.value;
                    if (result.action === "not_found") {
                        return {
                            content: [{ type: "text", text: "No matching memories found." }],
                            details: { found: 0 },
                        };
                    }
                    if (result.action === "deleted") {
                        return {
                            content: [{ type: "text", text: `Forgotten: "${result.text ?? query}"` }],
                            details: { action: "deleted", id: result.id },
                        };
                    }
                    const list = (result.candidates ?? [])
                        .map((r) => `- [${r.id}] ${r.text.slice(0, 60)}...`)
                        .join("\n");
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Found ${result.candidates?.length ?? 0} candidates. Specify memoryId:\n${list}`,
                            },
                        ],
                        details: { action: "candidates", candidates: result.candidates },
                    };
                }
                return {
                    content: [{ type: "text", text: "Provide query or memoryId." }],
                    details: { error: "missing_param" },
                };
            },
        }), { name: "memory_forget" });
        api.registerTool((ctx) => ({
            name: "memory_search",
            label: "Memory Search",
            description: "Search workspace memory files (MEMORY.md + memory/) using hybrid vector + keyword search.",
            parameters: Type.Object({
                query: Type.String({ description: "Search query" }),
                maxResults: Type.Optional(Type.Number({ description: "Maximum results (default: 8)" })),
                minScore: Type.Optional(Type.Number({ description: "Minimum score threshold (default: 0.2)" })),
            }),
            async execute(_toolCallId, params) {
                const { query, maxResults, minScore } = params;
                const agentId = resolveToolAgentId(ctx);
                const run = await withMemoryManager(agentId, ctx.sessionKey, "default", async (manager) => manager.search(query, {
                    ...(typeof maxResults === "number" ? { maxResults } : {}),
                    ...(typeof minScore === "number" ? { minScore } : {}),
                }));
                if (!run.ok) {
                    throw new Error(run.error);
                }
                const results = run.value;
                if (results.length === 0) {
                    return { content: [{ type: "text", text: "No results." }], details: { count: 0 } };
                }
                const text = results
                    .map((r, i) => `${i + 1}. ${r.path}:${r.startLine}-${r.endLine} (${(r.score * 100).toFixed(0)}%)\n${r.snippet}`)
                    .join("\n\n");
                return {
                    content: [{ type: "text", text }],
                    details: { count: results.length, results },
                };
            },
        }), { name: "memory_search" });
        api.registerTool((ctx) => ({
            name: "memory_get",
            label: "Memory Get",
            description: "Read a file segment from the workspace memory corpus.",
            parameters: Type.Object({
                path: Type.Optional(Type.String({ description: "Workspace-relative path (memory-core)" })),
                relPath: Type.Optional(Type.String({ description: "Workspace-relative path (alias)" })),
                from: Type.Optional(Type.Number({ description: "1-indexed start line (default: 1)" })),
                lines: Type.Optional(Type.Number({ description: "Line count (default: 200)" })),
            }),
            async execute(_toolCallId, params) {
                const relPath = resolveMemoryGetRelPath(params);
                const { from, lines } = params;
                const agentId = resolveToolAgentId(ctx);
                const run = await withMemoryManager(agentId, ctx.sessionKey, "default", async (manager) => manager.readFile({
                    relPath,
                    ...(typeof from === "number" ? { from } : {}),
                    ...(typeof lines === "number" ? { lines } : {}),
                }));
                if (!run.ok) {
                    throw new Error(run.error);
                }
                const res = run.value;
                return {
                    content: [{ type: "text", text: res.text }],
                    details: res,
                };
            },
        }), { name: "memory_get" });
        const printCliMemoryStatus = async (agentId, json) => {
            const { manager, error } = await memoryRuntime.getMemorySearchManager({
                cfg: (api.runtime.config?.current?.() ?? api.config),
                agentId,
                purpose: "status",
            });
            if (!manager) {
                console.log(formatMemoryStatusCliOutput({
                    ok: false,
                    error: error ?? "memory manager unavailable",
                    json,
                }).trimEnd());
                return;
            }
            try {
                console.log(formatMemoryStatusCliOutput({
                    ok: true,
                    status: manager.status(),
                    json,
                }).trimEnd());
            }
            finally {
                await manager.close?.().catch(() => undefined);
            }
        };
        api.registerCli(({ program }) => {
            const root = program.command("memory-zvec").description("Zvec memory plugin commands");
            root
                .command("list")
                .description("List indexed memory chunks (metadata)")
                .option("--agent <id>", "Agent id", "main")
                .option("--limit <n>", "Max results")
                .action(async (opts) => {
                const agentId = typeof opts.agent === "string" && opts.agent.trim().length > 0 ? opts.agent.trim() : "main";
                const limit = parsePositiveIntegerOption(opts.limit, "--limit");
                const run = await withMemoryManager(agentId, undefined, "cli", async (manager) => manager.exportChunksSnapshot());
                if (!run.ok) {
                    console.log(JSON.stringify({ ok: false, error: run.error }, null, 2));
                    process.exitCode = 1;
                    return;
                }
                const chunks = run.value.chunks;
                const slice = typeof limit === "number" ? chunks.slice(0, limit) : chunks;
                console.log(JSON.stringify(slice, null, 2));
            });
            root
                .command("search")
                .description("Hybrid search workspace memory")
                .argument("<query>", "Search query")
                .option("--agent <id>", "Agent id", "main")
                .option("--limit <n>", "Max results", "5")
                .action(async (query, opts) => {
                const agentId = typeof opts.agent === "string" && opts.agent.trim().length > 0 ? opts.agent.trim() : "main";
                const run = await withMemoryManager(agentId, undefined, "cli", async (manager) => manager.search(query, { maxResults: Number.parseInt(opts.limit, 10), minScore: 0.2 }));
                if (!run.ok) {
                    console.log(JSON.stringify({ ok: false, error: run.error }, null, 2));
                    process.exitCode = 1;
                    return;
                }
                console.log(JSON.stringify(run.value, null, 2));
            });
            root
                .command("get")
                .description("Read a workspace memory file segment (disk, or indexed fallback)")
                .argument("<path>", "Workspace-relative path")
                .option("--agent <id>", "Agent id", "main")
                .option("--from <n>", "1-indexed start line", "1")
                .option("--lines <n>", "Line count", "200")
                .action(async (filePath, opts) => {
                const agentId = typeof opts.agent === "string" && opts.agent.trim().length > 0 ? opts.agent.trim() : "main";
                const relPath = resolveMemoryGetRelPath({ path: filePath });
                const run = await withMemoryManager(agentId, undefined, "cli", async (manager) => manager.readFile({
                    relPath,
                    from: Number(opts.from),
                    lines: Number(opts.lines),
                }));
                if (!run.ok) {
                    console.log(JSON.stringify({ ok: false, error: run.error }, null, 2));
                    process.exitCode = 1;
                    return;
                }
                console.log(run.value.text);
            });
            root
                .command("stats")
                .description("Show memory index statistics")
                .option("--agent <id>", "Agent id", "main")
                .action(async (opts) => {
                const agentId = typeof opts.agent === "string" && opts.agent.trim().length > 0 ? opts.agent.trim() : "main";
                const run = await withMemoryManager(agentId, undefined, "cli", async (manager) => manager.status());
                if (!run.ok) {
                    console.log(JSON.stringify({ ok: false, error: run.error }, null, 2));
                    process.exitCode = 1;
                    return;
                }
                const st = run.value;
                console.log(JSON.stringify({
                    files: st.files,
                    chunks: st.chunks,
                    vector: st.vector,
                    fts: st.fts,
                }, null, 2));
            });
            root
                .command("index")
                .description("Reindex workspace memory files (MEMORY.md, USER.md, IDENTITY.md, memory/) into SQLite + Zvec")
                .option("--agent <id>", "Agent id", "main")
                .option("--force", "Force full reindex (re-embed all chunks)", false)
                .action(async (opts) => {
                const agentId = typeof opts.agent === "string" && opts.agent.trim().length > 0 ? opts.agent.trim() : "main";
                const { manager, error } = await memoryRuntime.getMemorySearchManager({
                    cfg: (api.runtime.config?.current?.() ?? api.config),
                    agentId,
                    purpose: "cli",
                });
                if (!manager) {
                    console.log(JSON.stringify({ ok: false, error: error ?? "memory manager unavailable" }, null, 2));
                    process.exitCode = 1;
                    return;
                }
                const syncFn = manager.sync?.bind(manager);
                if (!syncFn) {
                    console.log(JSON.stringify({ ok: false, error: "memory manager has no sync()" }, null, 2));
                    process.exitCode = 1;
                    return;
                }
                try {
                    await syncFn({ reason: "cli", force: Boolean(opts.force) });
                    console.log(JSON.stringify({ ok: true, reindexed: true, force: Boolean(opts.force) }, null, 2));
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
                    process.exitCode = 1;
                }
                finally {
                    await manager.close?.().catch(() => undefined);
                }
            });
            root
                .command("verify")
                .description("Alias for `memory-zvec status` — full paths + embedding/Zvec self-test")
                .option("--agent <id>", "Agent id", "main")
                .option("--json", "Print machine-readable JSON (default is human-readable tables)", false)
                .action(async (opts) => {
                const agentId = typeof opts.agent === "string" && opts.agent.trim().length > 0 ? opts.agent.trim() : "main";
                await printCliMemoryStatus(agentId, Boolean(opts.json));
            });
            root
                .command("export")
                .description("Export SQLite chunk metadata + IDs as JSON (vectors are not serialized; re-run index/reembed to rebuild Zvec)")
                .option("--agent <id>", "Agent id", "main")
                .option("-o, --output <path>", "Write to file instead of stdout")
                .action(async (opts) => {
                const agentId = typeof opts.agent === "string" && opts.agent.trim().length > 0 ? opts.agent.trim() : "main";
                const { manager, error } = await memoryRuntime.getMemorySearchManager({
                    cfg: (api.runtime.config?.current?.() ?? api.config),
                    agentId,
                    purpose: "cli",
                });
                if (!manager) {
                    console.log(JSON.stringify({ ok: false, error: error ?? "memory manager unavailable" }, null, 2));
                    process.exitCode = 1;
                    return;
                }
                try {
                    const zm = manager;
                    const snap = zm.exportChunksSnapshot();
                    const json = `${JSON.stringify(snap, null, 2)}\n`;
                    const outPath = typeof opts.output === "string" ? opts.output.trim() : "";
                    if (outPath.length > 0) {
                        await fsp.writeFile(outPath, json, "utf8");
                        console.log(JSON.stringify({ ok: true, written: outPath, chunks: snap.chunks.length }, null, 2));
                    }
                    else {
                        console.log(json.trimEnd());
                    }
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
                    process.exitCode = 1;
                }
                finally {
                    await manager.close?.().catch(() => undefined);
                }
            });
            root
                .command("import")
                .description("Import chunks JSON (from export); upserts SQLite + Zvec embeddings")
                .option("--agent <id>", "Agent id", "main")
                .requiredOption("-i, --input <path>", "JSON file path")
                .action(async (opts) => {
                const agentId = typeof opts.agent === "string" && opts.agent.trim().length > 0 ? opts.agent.trim() : "main";
                const inputPath = typeof opts.input === "string" ? opts.input.trim() : "";
                const { manager, error } = await memoryRuntime.getMemorySearchManager({
                    cfg: (api.runtime.config?.current?.() ?? api.config),
                    agentId,
                    purpose: "cli",
                });
                if (!manager) {
                    console.log(JSON.stringify({ ok: false, error: error ?? "memory manager unavailable" }, null, 2));
                    process.exitCode = 1;
                    return;
                }
                try {
                    const raw = await fsp.readFile(inputPath, "utf8");
                    const parsed = JSON.parse(raw);
                    if (!parsed.chunks || !Array.isArray(parsed.chunks)) {
                        throw new Error('JSON must contain a "chunks" array');
                    }
                    const zm = manager;
                    const result = await zm.applyChunksSnapshot(parsed.chunks);
                    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
                    process.exitCode = 1;
                }
                finally {
                    await manager.close?.().catch(() => undefined);
                }
            });
            root
                .command("reembed")
                .description("Recompute embeddings for every SQLite chunk and upsert into Zvec")
                .option("--agent <id>", "Agent id", "main")
                .option("--pause <ms>", "Optional pause between chunks (rate limiting)", "0")
                .action(async (opts) => {
                const agentId = typeof opts.agent === "string" && opts.agent.trim().length > 0 ? opts.agent.trim() : "main";
                const { manager, error } = await memoryRuntime.getMemorySearchManager({
                    cfg: (api.runtime.config?.current?.() ?? api.config),
                    agentId,
                    purpose: "cli",
                });
                if (!manager) {
                    console.log(JSON.stringify({ ok: false, error: error ?? "memory manager unavailable" }, null, 2));
                    process.exitCode = 1;
                    return;
                }
                try {
                    const zm = manager;
                    const pause = Number.parseInt(String(opts.pause ?? "0"), 10);
                    const result = await zm.reembedAll({
                        batchPauseMs: Number.isFinite(pause) ? Math.max(0, pause) : 0,
                    });
                    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
                    process.exitCode = 1;
                }
                finally {
                    await manager.close?.().catch(() => undefined);
                }
            });
            root
                .command("status")
                .description("Memory manager status (paths, SQLite, Zvec, embedding self-test). Text tables by default; use --json for scripts.")
                .option("--agent <id>", "Agent id", "main")
                .option("--json", "Print machine-readable JSON", false)
                .action(async (opts) => {
                const agentId = typeof opts.agent === "string" && opts.agent.trim().length > 0 ? opts.agent.trim() : "main";
                await printCliMemoryStatus(agentId, Boolean(opts.json));
            });
        }, { commands: ["memory-zvec"] });
        // Provide a minimal `memory` CLI for parity with memory-core when this plugin owns the slot.
        api.registerCli(({ program }) => {
            const memory = program.command("memory").description("Search, inspect, and reindex memory");
            memory
                .command("status")
                .description("Show memory status (may be skipped if another plugin registered `memory` first). Tables by default; use --json for scripts.")
                .option("--agent <id>", "Agent id", "main")
                .option("--json", "Print machine-readable JSON", false)
                .action(async (opts) => {
                const agentId = typeof opts.agent === "string" && opts.agent.trim().length > 0 ? opts.agent.trim() : "main";
                await printCliMemoryStatus(agentId, Boolean(opts.json));
            });
            memory
                .command("reindex")
                .description("Force a full reindex of workspace memory files")
                .option("--agent <id>", "Agent id", "main")
                .action(async (opts) => {
                const agentId = typeof opts.agent === "string" && opts.agent.trim().length > 0 ? opts.agent.trim() : "main";
                const run = await withMemoryManager(agentId, undefined, "cli", async (manager) => {
                    await manager.sync?.({ reason: "cli reindex", force: true });
                });
                if (!run.ok) {
                    throw new Error(run.error);
                }
                console.log("ok");
            });
            memory
                .command("search")
                .description("Hybrid search")
                .argument("<query>", "Query")
                .option("--agent <id>", "Agent id", "main")
                .option("--limit <n>", "Max results", "8")
                .action(async (query, opts) => {
                const agentId = typeof opts.agent === "string" && opts.agent.trim().length > 0 ? opts.agent.trim() : "main";
                const run = await withMemoryManager(agentId, undefined, "cli", async (manager) => manager.search(query, { maxResults: Number(opts.limit) }));
                if (!run.ok) {
                    throw new Error(run.error);
                }
                console.log(JSON.stringify(run.value, null, 2));
            });
            memory
                .command("get")
                .description("Read a file segment")
                .argument("<path>", "Workspace-relative path")
                .option("--agent <id>", "Agent id", "main")
                .option("--from <n>", "1-indexed start line", "1")
                .option("--lines <n>", "Line count", "200")
                .action(async (filePath, opts) => {
                const agentId = typeof opts.agent === "string" && opts.agent.trim().length > 0 ? opts.agent.trim() : "main";
                const relPath = resolveMemoryGetRelPath({ path: filePath });
                const run = await withMemoryManager(agentId, undefined, "cli", async (manager) => manager.readFile({
                    relPath,
                    from: Number(opts.from),
                    lines: Number(opts.lines),
                }));
                if (!run.ok) {
                    throw new Error(run.error);
                }
                console.log(run.value.text);
            });
        }, { commands: ["memory"] });
        api.on("before_prompt_build", async (event, ctx) => {
            const agentId = resolveHookAgentId(ctx);
            const currentCfg = resolveCurrentHookConfig(agentId);
            if (!currentCfg.autoRecall) {
                return undefined;
            }
            if (!event.prompt || event.prompt.length < 5) {
                return undefined;
            }
            if (isMemoryZvecDebug()) {
                api.logger.debug?.(`memory-zvec: auto-recall (${describeEmbeddingEndpoint(currentCfg.embedding)})`);
            }
            try {
                const recallQuery = normalizeRecallQuery(extractLatestUserText(Array.isArray(event.messages) ? event.messages : []) ??
                    event.prompt, currentCfg.recallMaxChars);
                if (shouldSkipAdaptiveRecall({
                    query: recallQuery,
                    enabled: currentCfg.adaptive.enabled,
                    minCharsEn: currentCfg.adaptive.minCharsEn,
                    minCharsCjk: currentCfg.adaptive.minCharsCjk,
                })) {
                    return undefined;
                }
                const recallTimeoutMs = typeof currentCfg.autoRecallTimeoutMs === "number"
                    ? currentCfg.autoRecallTimeoutMs
                    : DEFAULT_AUTO_RECALL_TIMEOUT_MS;
                const recall = await runWithTimeout({
                    timeoutMs: recallTimeoutMs,
                    task: async () => {
                        const run = await withMemoryManager(agentId, ctx.sessionKey, "default", async (manager) => manager.search(recallQuery, { maxResults: 3, minScore: 0.3 }));
                        if (!run.ok) {
                            throw new Error(run.error);
                        }
                        return run.value;
                    },
                });
                if (recall.status === "timeout") {
                    api.logger.warn?.(`memory-zvec: auto-recall timed out after ${recallTimeoutMs}ms`);
                    return undefined;
                }
                const results = recall.value;
                if (results.length === 0) {
                    return undefined;
                }
                api.logger.info?.(`memory-zvec: injecting ${results.length} memories`);
                return {
                    prependContext: formatRelevantMemoriesContext(results.map((r) => ({
                        category: "other",
                        text: r.snippet ?? r.path,
                        path: `${r.path}:${r.startLine}-${r.endLine}`,
                    }))),
                };
            }
            catch (err) {
                api.logger.warn(`memory-zvec: recall failed [agent=${agentId}] [${describeEmbeddingEndpoint(currentCfg.embedding)}]: ${formatErrorDiagnostic(err)}`);
            }
            return undefined;
        });
        api.on("agent_end", async (event, ctx) => {
            const agentId = resolveHookAgentId(ctx);
            const currentCfg = resolveCurrentHookConfig(agentId);
            if (!currentCfg.autoCapture) {
                return;
            }
            if (!event.success || !event.messages || event.messages.length === 0) {
                return;
            }
            try {
                const cursorKey = ctx.sessionKey ?? ctx.sessionId;
                const startIndex = resolveAutoCaptureStartIndex(event.messages, cursorKey ? autoCaptureCursors.get(cursorKey) : undefined);
                let stored = 0;
                let capturableSeen = 0;
                const baseCfg = getRuntimeCfg();
                for (let index = startIndex; index < event.messages.length; index++) {
                    const message = event.messages[index];
                    let messageProcessed = false;
                    try {
                        for (const text of extractUserTextContent(message)) {
                            if (!text || !shouldCapture(text, { maxChars: currentCfg.captureMaxChars })) {
                                continue;
                            }
                            capturableSeen++;
                            if (capturableSeen > 3) {
                                continue;
                            }
                            const category = detectCategory(text);
                            const run = await withMemoryManager(agentId, ctx.sessionKey, "default", async (manager) => {
                                const dupes = await manager.search(text, { maxResults: 1, minScore: 0.95 });
                                if (dupes.length > 0) {
                                    return false;
                                }
                                const note = await appendMemoryNote({
                                    workspaceDir: manager.getWorkspaceDir(),
                                    text,
                                    category,
                                    cfg: baseCfg,
                                });
                                if (!note.appended) {
                                    return false;
                                }
                                await manager.sync?.({ reason: "auto-capture", force: false });
                                return true;
                            });
                            if (run.ok && run.value) {
                                stored++;
                            }
                        }
                        messageProcessed = true;
                    }
                    finally {
                        if (messageProcessed && cursorKey) {
                            autoCaptureCursors.set(cursorKey, {
                                nextIndex: index + 1,
                                lastMessageFingerprint: messageFingerprint(message),
                            });
                        }
                    }
                }
                if (stored > 0) {
                    api.logger.info(`memory-zvec: auto-captured ${stored} memories [agent=${agentId}]`);
                }
            }
            catch (err) {
                api.logger.warn(`memory-zvec: capture failed [agent=${agentId}] [${describeEmbeddingEndpoint(currentCfg.embedding)}]: ${formatErrorDiagnostic(err)}`);
            }
        });
        api.on("session_end", (event, ctx) => {
            const cursorKey = ctx.sessionKey ?? event.sessionKey ?? ctx.sessionId ?? event.sessionId;
            autoCaptureCursors.delete(cursorKey);
            const nextCursorKey = event.nextSessionKey ?? event.nextSessionId;
            if (nextCursorKey) {
                autoCaptureCursors.delete(nextCursorKey);
            }
        });
        api.registerService({
            id: "memory-zvec",
            start: () => {
                api.logger.info(`memory-zvec: active (data: ${resolvedDataRoot}, ${describeEmbeddingEndpoint(cfg.embedding)})`);
            },
            stop: () => {
                api.logger.info("memory-zvec: stopped");
            },
        });
    },
});
//# sourceMappingURL=index.js.map