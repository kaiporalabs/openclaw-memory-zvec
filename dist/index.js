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
            cfg = memoryConfigSchema.parse(api.pluginConfig);
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
        const resolveCurrentHookConfig = () => {
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
                autoCapture: cfg.autoCapture,
                autoRecall: cfg.autoRecall,
                captureMaxChars: cfg.captureMaxChars,
                recallMaxChars: cfg.recallMaxChars,
                ...asRecord(runtimePluginConfig),
            });
        };
        api.logger.info(`memory-zvec: registered (data: ${resolvedDataRoot}, dim=${vectorDim}, lazy Zvec init)`);
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
                const currentCfg = resolveCurrentHookConfig();
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
                    const currentCfg = resolveCurrentHookConfig();
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
        api.on("before_prompt_build", async (event) => {
            const currentCfg = resolveCurrentHookConfig();
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
            const currentCfg = resolveCurrentHookConfig();
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