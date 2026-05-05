/**
 * OpenClaw Memory (Zvec) — long-term memory with local ANN via @zvec/zvec.
 */
import { Type } from "typebox";
import { resolveLivePluginConfigObject } from "openclaw/plugin-sdk/plugin-config-runtime";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createEmbeddings } from "./embeddings.js";
import { memoryConfigSchema, vectorDimsForModel, MEMORY_CATEGORIES, } from "./config.js";
import { DEFAULT_AUTO_RECALL_TIMEOUT_MS, extractLatestUserText, extractUserTextContent, formatRelevantMemoriesContext, messageFingerprint, normalizeRecallQuery, resolveAutoCaptureStartIndex, shouldCapture, detectCategory, } from "./runtime-helpers.js";
import { MemoryZvecStore } from "./zvec-store.js";
import { ZvecSqliteMemoryManager } from "./memory-manager.js";
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
export default definePluginEntry({
    id: "memory-zvec",
    name: "Memory (Zvec)",
    description: "Zvec-backed long-term memory with auto-recall/capture (Ollama-friendly embeddings)",
    kind: "memory",
    configSchema: memoryConfigSchema,
    register(api) {
        let cfg;
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
        const db = new MemoryZvecStore(resolvedDataRoot, vectorDim);
        const embeddings = createEmbeddings(api, cfg);
        const autoCaptureCursors = new Map();
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
                dbPath: cfg.dbPath,
                sqlitePath: cfg.sqlitePath,
                autoCapture: cfg.autoCapture,
                autoRecall: cfg.autoRecall,
                captureMaxChars: cfg.captureMaxChars,
                recallMaxChars: cfg.recallMaxChars,
                ...asRecord(runtimePluginConfig),
            }, { agentId });
        };
        api.logger.info(`memory-zvec: registered (data: ${resolvedDataRoot}, dim=${vectorDim}, lazy Zvec init)`);
        // Register full memory capability so OpenClaw status/CLI/tools can resolve the active memory runtime.
        const memoryRuntime = {
            async getMemorySearchManager(params) {
                const agentId = params.agentId ?? "main";
                const baseCfg = (api.runtime.config?.current?.() ?? api.config);
                const effectiveCfg = resolveCurrentHookConfig(agentId);
                const resolvedSqlitePath = effectiveCfg.sqlitePath.includes("://")
                    ? effectiveCfg.sqlitePath
                    : api.resolvePath(effectiveCfg.sqlitePath);
                const resolvedZvecRoot = effectiveCfg.dbPath.includes("://")
                    ? effectiveCfg.dbPath
                    : api.resolvePath(effectiveCfg.dbPath);
                const manager = new ZvecSqliteMemoryManager({ ...effectiveCfg, sqlitePath: resolvedSqlitePath, dbPath: resolvedZvecRoot }, api.runtime.agent.resolveAgentWorkspaceDir(baseCfg, agentId), agentId, createEmbeddings(api, effectiveCfg), new MemoryZvecStore(resolvedZvecRoot, vectorDim));
                if (params.purpose !== "status") {
                    await manager.sync({ reason: "open", force: false }).catch(() => undefined);
                }
                return { manager };
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
        api.registerMemoryCapability({
            runtime: memoryRuntime,
            promptBuilder,
            flushPlanResolver: () => null,
        });
        api.registerTool({
            name: "memory_recall",
            label: "Memory Recall",
            description: "Search long-term memories (Zvec ANN). Use for user preferences, past decisions, or prior topics.",
            parameters: Type.Object({
                query: Type.String({ description: "Search query" }),
                limit: Type.Optional(Type.Number({ description: "Max results (default: 5)" })),
            }),
            async execute(_toolCallId, params) {
                const { query, limit = 5 } = params;
                const currentCfg = resolveCurrentHookConfig("main");
                const vector = await embeddings.embed(normalizeRecallQuery(query, currentCfg.recallMaxChars));
                const results = await db.search(vector, limit, 0.1);
                if (results.length === 0) {
                    return {
                        content: [{ type: "text", text: "No relevant memories found." }],
                        details: { count: 0 },
                    };
                }
                const text = results
                    .map((r, i) => `${i + 1}. [${r.entry.category}] ${r.entry.text} (${(r.score * 100).toFixed(0)}%)`)
                    .join("\n");
                const sanitizedResults = results.map((r) => ({
                    id: r.entry.id,
                    text: r.entry.text,
                    category: r.entry.category,
                    importance: r.entry.importance,
                    score: r.score,
                }));
                return {
                    content: [{ type: "text", text: `Found ${results.length} memories:\n\n${text}` }],
                    details: { count: results.length, memories: sanitizedResults },
                };
            },
        }, { name: "memory_recall" });
        api.registerTool({
            name: "memory_store",
            label: "Memory Store",
            description: "Persist important information in Zvec-backed long-term memory.",
            parameters: Type.Object({
                text: Type.String({ description: "Information to remember" }),
                importance: Type.Optional(Type.Number({ description: "Importance 0-1 (default: 0.7)" })),
                category: Type.Optional(Type.Unsafe({
                    type: "string",
                    enum: [...MEMORY_CATEGORIES],
                })),
            }),
            async execute(_toolCallId, params) {
                const { text, importance = 0.7, category = "other", } = params;
                const vector = await embeddings.embed(text);
                const existing = await db.search(vector, 1, 0.95);
                if (existing.length > 0) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Similar memory already exists: "${existing[0].entry.text}"`,
                            },
                        ],
                        details: {
                            action: "duplicate",
                            existingId: existing[0].entry.id,
                            existingText: existing[0].entry.text,
                        },
                    };
                }
                const entry = await db.store({
                    text,
                    vector,
                    importance,
                    category,
                });
                return {
                    content: [{ type: "text", text: `Stored: "${text.slice(0, 100)}..."` }],
                    details: { action: "created", id: entry.id },
                };
            },
        }, { name: "memory_store" });
        api.registerTool({
            name: "memory_forget",
            label: "Memory Forget",
            description: "Delete memories by id or by semantic match.",
            parameters: Type.Object({
                query: Type.Optional(Type.String({ description: "Search to find memory" })),
                memoryId: Type.Optional(Type.String({ description: "Specific memory ID" })),
            }),
            async execute(_toolCallId, params) {
                const { query, memoryId } = params;
                if (memoryId) {
                    if (!UUID_RE.test(memoryId)) {
                        throw new Error(`Invalid memory ID format: ${memoryId}`);
                    }
                    await db.delete(memoryId);
                    return {
                        content: [{ type: "text", text: `Memory ${memoryId} forgotten.` }],
                        details: { action: "deleted", id: memoryId },
                    };
                }
                if (query) {
                    const currentCfg = resolveCurrentHookConfig("main");
                    const vector = await embeddings.embed(normalizeRecallQuery(query, currentCfg.recallMaxChars));
                    const results = await db.search(vector, 5, 0.7);
                    if (results.length === 0) {
                        return {
                            content: [{ type: "text", text: "No matching memories found." }],
                            details: { found: 0 },
                        };
                    }
                    if (results.length === 1 && results[0].score > 0.9) {
                        await db.delete(results[0].entry.id);
                        return {
                            content: [{ type: "text", text: `Forgotten: "${results[0].entry.text}"` }],
                            details: { action: "deleted", id: results[0].entry.id },
                        };
                    }
                    const list = results
                        .map((r) => `- [${r.entry.id}] ${r.entry.text.slice(0, 60)}...`)
                        .join("\n");
                    const sanitizedCandidates = results.map((r) => ({
                        id: r.entry.id,
                        text: r.entry.text,
                        category: r.entry.category,
                        score: r.score,
                    }));
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Found ${results.length} candidates. Specify memoryId:\n${list}`,
                            },
                        ],
                        details: { action: "candidates", candidates: sanitizedCandidates },
                    };
                }
                return {
                    content: [{ type: "text", text: "Provide query or memoryId." }],
                    details: { error: "missing_param" },
                };
            },
        }, { name: "memory_forget" });
        // OpenClaw memory slot tools (parity with memory-core).
        api.registerTool({
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
                const { manager, error } = await memoryRuntime.getMemorySearchManager({
                    cfg: (api.runtime.config?.current?.() ?? api.config),
                    agentId: "main",
                    purpose: "default",
                });
                if (!manager) {
                    throw new Error(error ?? "memory manager unavailable");
                }
                const results = await manager.search(query, {
                    ...(typeof maxResults === "number" ? { maxResults } : {}),
                    ...(typeof minScore === "number" ? { minScore } : {}),
                });
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
        }, { name: "memory_search" });
        api.registerTool({
            name: "memory_get",
            label: "Memory Get",
            description: "Read a file segment from the workspace memory corpus.",
            parameters: Type.Object({
                relPath: Type.String({ description: "Workspace-relative path" }),
                from: Type.Optional(Type.Number({ description: "1-indexed start line (default: 1)" })),
                lines: Type.Optional(Type.Number({ description: "Line count (default: 200)" })),
            }),
            async execute(_toolCallId, params) {
                const { relPath, from, lines } = params;
                const { manager, error } = await memoryRuntime.getMemorySearchManager({
                    cfg: (api.runtime.config?.current?.() ?? api.config),
                    agentId: "main",
                    purpose: "default",
                });
                if (!manager) {
                    throw new Error(error ?? "memory manager unavailable");
                }
                const res = await manager.readFile({
                    relPath,
                    ...(typeof from === "number" ? { from } : {}),
                    ...(typeof lines === "number" ? { lines } : {}),
                });
                return {
                    content: [{ type: "text", text: res.text }],
                    details: res,
                };
            },
        }, { name: "memory_get" });
        api.registerCli(({ program }) => {
            const root = program.command("memory-zvec").description("Zvec memory plugin commands");
            root
                .command("list")
                .description("List memories (metadata only)")
                .option("--limit <n>", "Max results")
                .option("--order-by-created-at", "Order by createdAt descending", false)
                .action(async (opts) => {
                const limit = parsePositiveIntegerOption(opts.limit, "--limit");
                const entries = await db.list(limit, Boolean(opts.orderByCreatedAt));
                console.log(JSON.stringify(entries, null, 2));
            });
            root
                .command("search")
                .description("Vector search memories")
                .argument("<query>", "Search query")
                .option("--limit <n>", "Max results", "5")
                .action(async (query, opts) => {
                const vector = await embeddings.embed(normalizeRecallQuery(query, cfg.recallMaxChars));
                const results = await db.search(vector, Number.parseInt(opts.limit, 10), 0.3);
                const output = results.map((r) => ({
                    id: r.entry.id,
                    text: r.entry.text,
                    category: r.entry.category,
                    importance: r.entry.importance,
                    score: r.score,
                }));
                console.log(JSON.stringify(output, null, 2));
            });
            root
                .command("stats")
                .description("Show memory statistics")
                .action(async () => {
                const count = await db.count();
                console.log(`Total memories: ${count}`);
            });
        }, { commands: ["memory-zvec"] });
        // Provide a minimal `memory` CLI for parity with memory-core when this plugin owns the slot.
        api.registerCli(({ program }) => {
            const memory = program.command("memory").description("Search, inspect, and reindex memory");
            memory
                .command("status")
                .description("Show memory status")
                .action(async () => {
                const { manager, error } = await memoryRuntime.getMemorySearchManager({
                    cfg: (api.runtime.config?.current?.() ?? api.config),
                    agentId: "main",
                    purpose: "status",
                });
                if (!manager) {
                    console.log(JSON.stringify({ ok: false, error: error ?? "memory manager unavailable" }, null, 2));
                    return;
                }
                console.log(JSON.stringify({ ok: true, status: manager.status() }, null, 2));
            });
            memory
                .command("reindex")
                .description("Force a full reindex of workspace memory files")
                .action(async () => {
                const { manager, error } = await memoryRuntime.getMemorySearchManager({
                    cfg: (api.runtime.config?.current?.() ?? api.config),
                    agentId: "main",
                    purpose: "cli",
                });
                if (!manager) {
                    throw new Error(error ?? "memory manager unavailable");
                }
                await manager.sync?.({ reason: "cli reindex", force: true });
                console.log("ok");
            });
            memory
                .command("search")
                .description("Hybrid search")
                .argument("<query>", "Query")
                .option("--limit <n>", "Max results", "8")
                .action(async (query, opts) => {
                const { manager, error } = await memoryRuntime.getMemorySearchManager({
                    cfg: (api.runtime.config?.current?.() ?? api.config),
                    agentId: "main",
                    purpose: "cli",
                });
                if (!manager) {
                    throw new Error(error ?? "memory manager unavailable");
                }
                const results = await manager.search(query, { maxResults: Number(opts.limit) });
                console.log(JSON.stringify(results, null, 2));
            });
            memory
                .command("get")
                .description("Read a file segment")
                .argument("<relPath>", "Workspace-relative path")
                .option("--from <n>", "1-indexed start line", "1")
                .option("--lines <n>", "Line count", "200")
                .action(async (relPath, opts) => {
                const { manager, error } = await memoryRuntime.getMemorySearchManager({
                    cfg: (api.runtime.config?.current?.() ?? api.config),
                    agentId: "main",
                    purpose: "cli",
                });
                if (!manager) {
                    throw new Error(error ?? "memory manager unavailable");
                }
                const res = await manager.readFile({
                    relPath,
                    from: Number(opts.from),
                    lines: Number(opts.lines),
                });
                console.log(res.text);
            });
        }, { commands: ["memory"] });
        api.on("before_prompt_build", async (event) => {
            const currentCfg = resolveCurrentHookConfig("main");
            if (!currentCfg.autoRecall) {
                return undefined;
            }
            if (!event.prompt || event.prompt.length < 5) {
                return undefined;
            }
            try {
                const recallQuery = normalizeRecallQuery(extractLatestUserText(Array.isArray(event.messages) ? event.messages : []) ??
                    event.prompt, currentCfg.recallMaxChars);
                const recall = await runWithTimeout({
                    timeoutMs: DEFAULT_AUTO_RECALL_TIMEOUT_MS,
                    task: async () => {
                        const vector = await embeddings.embed(recallQuery, {
                            timeoutMs: DEFAULT_AUTO_RECALL_TIMEOUT_MS,
                        });
                        return await db.search(vector, 3, 0.3);
                    },
                });
                if (recall.status === "timeout") {
                    api.logger.warn?.(`memory-zvec: auto-recall timed out after ${DEFAULT_AUTO_RECALL_TIMEOUT_MS}ms`);
                    return undefined;
                }
                const results = recall.value;
                if (results.length === 0) {
                    return undefined;
                }
                api.logger.info?.(`memory-zvec: injecting ${results.length} memories`);
                return {
                    prependContext: formatRelevantMemoriesContext(results.map((r) => ({ category: r.entry.category, text: r.entry.text }))),
                };
            }
            catch (err) {
                api.logger.warn(`memory-zvec: recall failed: ${String(err)}`);
            }
            return undefined;
        });
        api.on("agent_end", async (event, ctx) => {
            const currentCfg = resolveCurrentHookConfig("main");
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
                            const vector = await embeddings.embed(text);
                            const existing = await db.search(vector, 1, 0.95);
                            if (existing.length > 0) {
                                continue;
                            }
                            await db.store({
                                text,
                                vector,
                                importance: 0.7,
                                category,
                            });
                            stored++;
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
                    api.logger.info(`memory-zvec: auto-captured ${stored} memories`);
                }
            }
            catch (err) {
                api.logger.warn(`memory-zvec: capture failed: ${String(err)}`);
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
                api.logger.info(`memory-zvec: active (data: ${resolvedDataRoot}, model: ${cfg.embedding.model})`);
            },
            stop: () => {
                void db.close();
                api.logger.info("memory-zvec: stopped");
            },
        });
    },
});
//# sourceMappingURL=index.js.map