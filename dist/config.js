import fs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export const MEMORY_CATEGORIES = ["preference", "fact", "decision", "entity", "other"];
const DEFAULT_MODEL = "nomic-embed-text";
export const DEFAULT_CAPTURE_MAX_CHARS = 500;
export const DEFAULT_RECALL_MAX_CHARS = 1000;
export function resolveDefaultDbPath() {
    return join(homedir(), ".openclaw", "memory", "zvec");
}
const DEFAULT_DB_PATH = resolveDefaultDbPath();
/** Default SQLite path for chunk metadata + FTS (`~/.openclaw/memory/<agentId>.sqlite`). */
export function resolveDefaultSqlitePath(agentId) {
    return join(homedir(), ".openclaw", "memory", `${agentId}.sqlite`);
}
/** Known OpenAI + common Ollama embedding models (always set `dimensions` if yours is missing). */
const EMBEDDING_DIMENSIONS = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "nomic-embed-text": 768,
    "mxbai-embed-large": 1024,
    "bge-m3": 1024,
    "snowflake-arctic-embed": 1024,
};
const EMBEDDING_CONFIG_KEYS = ["provider", "apiKey", "model", "baseUrl", "dimensions"];
function assertAllowedKeys(value, allowed, label) {
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
        throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
    }
}
export function vectorDimsForModel(model) {
    const dims = EMBEDDING_DIMENSIONS[model];
    if (!dims) {
        throw new Error(`Unknown embedding model dimension map entry: "${model}". ` +
            `Set embedding.dimensions in plugin config (required for most Ollama models).`);
    }
    return dims;
}
function resolveEnvVars(value) {
    return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
        const envValue = process.env[envVar];
        if (!envValue) {
            throw new Error(`Environment variable ${envVar} is not set`);
        }
        return envValue;
    });
}
function resolveEmbeddingModel(embedding) {
    return typeof embedding.model === "string" ? embedding.model : DEFAULT_MODEL;
}
export const memoryConfigSchema = {
    parse(value, opts) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("memory config required");
        }
        const cfg = value;
        assertAllowedKeys(cfg, [
            "embedding",
            "dreaming",
            "dbPath",
            "sqlitePath",
            "autoCapture",
            "autoRecall",
            "captureMaxChars",
            "recallMaxChars",
        ], "memory config");
        const embedding = cfg.embedding;
        if (!embedding || typeof embedding !== "object" || Array.isArray(embedding)) {
            throw new Error("embedding config required");
        }
        assertAllowedKeys(embedding, [...EMBEDDING_CONFIG_KEYS], "embedding config");
        if (Object.keys(embedding).length === 0) {
            throw new Error("embedding config must include at least one setting");
        }
        const model = resolveEmbeddingModel(embedding);
        const provider = typeof embedding.provider === "string" ? embedding.provider.trim() : "ollama";
        if (!provider) {
            throw new Error("embedding.provider must not be empty");
        }
        if (typeof embedding.dimensions !== "number") {
            vectorDimsForModel(model);
        }
        const captureMaxChars = typeof cfg.captureMaxChars === "number" ? Math.floor(cfg.captureMaxChars) : undefined;
        const recallMaxChars = typeof cfg.recallMaxChars === "number" ? Math.floor(cfg.recallMaxChars) : undefined;
        if (typeof captureMaxChars === "number" &&
            (captureMaxChars < 100 || captureMaxChars > 10_000)) {
            throw new Error("captureMaxChars must be between 100 and 10000");
        }
        if (typeof recallMaxChars === "number" && (recallMaxChars < 100 || recallMaxChars > 10_000)) {
            throw new Error("recallMaxChars must be between 100 and 10000");
        }
        const dreaming = cfg.dreaming === undefined
            ? undefined
            : cfg.dreaming && typeof cfg.dreaming === "object" && !Array.isArray(cfg.dreaming)
                ? cfg.dreaming
                : (() => {
                    throw new Error("dreaming config must be an object");
                })();
        const dbPathRaw = typeof cfg.dbPath === "string" ? cfg.dbPath.trim() : "";
        const sqlitePathRaw = typeof cfg.sqlitePath === "string" ? cfg.sqlitePath.trim() : "";
        return {
            embedding: {
                provider,
                model,
                apiKey: typeof embedding.apiKey === "string" ? resolveEnvVars(embedding.apiKey) : undefined,
                baseUrl: typeof embedding.baseUrl === "string" ? resolveEnvVars(embedding.baseUrl) : undefined,
                dimensions: typeof embedding.dimensions === "number" ? embedding.dimensions : undefined,
            },
            dreaming,
            dbPath: dbPathRaw.length > 0 ? dbPathRaw : DEFAULT_DB_PATH,
            sqlitePath: sqlitePathRaw.length > 0
                ? sqlitePathRaw
                : resolveDefaultSqlitePath(opts?.agentId ?? "main"),
            autoCapture: cfg.autoCapture === true,
            autoRecall: cfg.autoRecall !== false,
            captureMaxChars: captureMaxChars ?? DEFAULT_CAPTURE_MAX_CHARS,
            recallMaxChars: recallMaxChars ?? DEFAULT_RECALL_MAX_CHARS,
        };
    },
};
//# sourceMappingURL=config.js.map