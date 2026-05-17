import { homedir } from "node:os";
import { join } from "node:path";
export const MEMORY_CATEGORIES = ["preference", "fact", "decision", "entity", "other"];
const DEFAULT_MODEL = "nomic-embed-text";
export const DEFAULT_CAPTURE_MAX_CHARS = 500;
export const DEFAULT_RECALL_MAX_CHARS = 1000;
export const DEFAULT_AUTO_RECALL_TIMEOUT_MS = 15_000;
export const DEFAULT_RETRIEVAL = {
    mode: "hybrid",
    vectorWeight: 0.65,
    ftsWeight: 0.35,
    minScore: 0.2,
    hardMinScore: 0.08,
    mmrEnabled: true,
    mmrLambda: 0.65,
    mmrPoolSize: 36,
};
export const DEFAULT_RERANK = {
    enabled: false,
    endpoint: "",
    model: "jina-reranker-v2-base-multilingual",
    candidatePoolSize: 16,
    timeoutMs: 8000,
    rerankBlendWeight: 0.45,
};
export const DEFAULT_ADAPTIVE = {
    enabled: true,
    minCharsEn: 15,
    minCharsCjk: 6,
};
export const DEFAULT_DECAY = {
    enabled: false,
    halfLifeDays: 60,
    blendWeight: 0.35,
};
export const DEFAULT_SCOPES = {
    defaultMemoryScope: "global",
};
export const DEFAULT_SMART_EXTRACTION = {
    enabled: false,
};
export function resolveDefaultDbPath(agentId = "main") {
    const id = agentId.trim().length > 0 ? agentId.trim() : "main";
    return join(homedir(), ".openclaw", "memory", "zvec", id);
}
export function resolveDefaultSqlitePath(agentId) {
    return join(homedir(), ".openclaw", "memory", `${agentId}.sqlite`);
}
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
function parseRetrieval(input) {
    if (input === undefined || input === null) {
        return { ...DEFAULT_RETRIEVAL };
    }
    if (typeof input !== "object" || Array.isArray(input)) {
        throw new Error("retrieval config must be an object");
    }
    const r = input;
    assertAllowedKeys(r, [
        "mode",
        "vectorWeight",
        "ftsWeight",
        "minScore",
        "hardMinScore",
        "mmrEnabled",
        "mmrLambda",
        "mmrPoolSize",
    ], "retrieval config");
    const modeRaw = typeof r.mode === "string" ? r.mode : "hybrid";
    const mode = modeRaw === "vector" || modeRaw === "fts" || modeRaw === "hybrid" ? modeRaw : "hybrid";
    const vectorWeight = typeof r.vectorWeight === "number" && Number.isFinite(r.vectorWeight)
        ? Math.min(1, Math.max(0, r.vectorWeight))
        : DEFAULT_RETRIEVAL.vectorWeight;
    const ftsWeight = typeof r.ftsWeight === "number" && Number.isFinite(r.ftsWeight)
        ? Math.min(1, Math.max(0, r.ftsWeight))
        : DEFAULT_RETRIEVAL.ftsWeight;
    const minScore = typeof r.minScore === "number" && Number.isFinite(r.minScore)
        ? Math.min(1, Math.max(0, r.minScore))
        : DEFAULT_RETRIEVAL.minScore;
    const hardMinScore = typeof r.hardMinScore === "number" && Number.isFinite(r.hardMinScore)
        ? Math.min(1, Math.max(0, r.hardMinScore))
        : DEFAULT_RETRIEVAL.hardMinScore;
    const mmrEnabled = typeof r.mmrEnabled === "boolean" ? r.mmrEnabled : DEFAULT_RETRIEVAL.mmrEnabled;
    const mmrLambda = typeof r.mmrLambda === "number" && Number.isFinite(r.mmrLambda)
        ? Math.min(1, Math.max(0.05, r.mmrLambda))
        : DEFAULT_RETRIEVAL.mmrLambda;
    const mmrPoolSize = typeof r.mmrPoolSize === "number" && Number.isFinite(r.mmrPoolSize)
        ? Math.floor(Math.min(200, Math.max(8, r.mmrPoolSize)))
        : DEFAULT_RETRIEVAL.mmrPoolSize;
    return {
        mode,
        vectorWeight,
        ftsWeight,
        minScore,
        hardMinScore,
        mmrEnabled,
        mmrLambda,
        mmrPoolSize,
    };
}
function parseRerank(input) {
    if (input === undefined || input === null) {
        return { ...DEFAULT_RERANK };
    }
    if (typeof input !== "object" || Array.isArray(input)) {
        throw new Error("rerank config must be an object");
    }
    const r = input;
    assertAllowedKeys(r, ["enabled", "endpoint", "apiKey", "model", "candidatePoolSize", "timeoutMs", "rerankBlendWeight"], "rerank config");
    const enabled = r.enabled === true;
    const endpoint = typeof r.endpoint === "string" ? r.endpoint.trim() : "";
    const apiKey = typeof r.apiKey === "string" ? resolveEnvVars(r.apiKey) : undefined;
    const model = typeof r.model === "string" ? r.model.trim() : DEFAULT_RERANK.model;
    const candidatePoolSize = typeof r.candidatePoolSize === "number" && Number.isFinite(r.candidatePoolSize)
        ? Math.floor(Math.min(64, Math.max(4, r.candidatePoolSize)))
        : DEFAULT_RERANK.candidatePoolSize;
    const timeoutMs = typeof r.timeoutMs === "number" && Number.isFinite(r.timeoutMs)
        ? Math.floor(Math.min(120_000, Math.max(500, r.timeoutMs)))
        : DEFAULT_RERANK.timeoutMs;
    const rerankBlendWeight = typeof r.rerankBlendWeight === "number" && Number.isFinite(r.rerankBlendWeight)
        ? Math.min(1, Math.max(0, r.rerankBlendWeight))
        : DEFAULT_RERANK.rerankBlendWeight;
    return {
        enabled,
        endpoint,
        apiKey,
        model,
        candidatePoolSize,
        timeoutMs,
        rerankBlendWeight,
    };
}
function parseAdaptive(input) {
    if (input === undefined || input === null) {
        return { ...DEFAULT_ADAPTIVE };
    }
    if (typeof input !== "object" || Array.isArray(input)) {
        throw new Error("adaptive config must be an object");
    }
    const r = input;
    assertAllowedKeys(r, ["enabled", "minCharsEn", "minCharsCjk"], "adaptive config");
    return {
        enabled: r.enabled !== false,
        minCharsEn: typeof r.minCharsEn === "number" && Number.isFinite(r.minCharsEn)
            ? Math.floor(Math.min(200, Math.max(1, r.minCharsEn)))
            : DEFAULT_ADAPTIVE.minCharsEn,
        minCharsCjk: typeof r.minCharsCjk === "number" && Number.isFinite(r.minCharsCjk)
            ? Math.floor(Math.min(50, Math.max(1, r.minCharsCjk)))
            : DEFAULT_ADAPTIVE.minCharsCjk,
    };
}
function parseDecay(input) {
    if (input === undefined || input === null) {
        return { ...DEFAULT_DECAY };
    }
    if (typeof input !== "object" || Array.isArray(input)) {
        throw new Error("decay config must be an object");
    }
    const r = input;
    assertAllowedKeys(r, ["enabled", "halfLifeDays", "blendWeight"], "decay config");
    return {
        enabled: r.enabled === true,
        halfLifeDays: typeof r.halfLifeDays === "number" && Number.isFinite(r.halfLifeDays)
            ? Math.min(3650, Math.max(1, r.halfLifeDays))
            : DEFAULT_DECAY.halfLifeDays,
        blendWeight: typeof r.blendWeight === "number" && Number.isFinite(r.blendWeight)
            ? Math.min(1, Math.max(0, r.blendWeight))
            : DEFAULT_DECAY.blendWeight,
    };
}
function parseScopes(input) {
    if (input === undefined || input === null) {
        return { ...DEFAULT_SCOPES };
    }
    if (typeof input !== "object" || Array.isArray(input)) {
        throw new Error("scopes config must be an object");
    }
    const r = input;
    assertAllowedKeys(r, ["defaultMemoryScope", "agentAccess"], "scopes config");
    const defaultMemoryScope = typeof r.defaultMemoryScope === "string" && r.defaultMemoryScope.trim().length > 0
        ? r.defaultMemoryScope.trim()
        : DEFAULT_SCOPES.defaultMemoryScope;
    let agentAccess;
    if (r.agentAccess && typeof r.agentAccess === "object" && !Array.isArray(r.agentAccess)) {
        agentAccess = {};
        for (const [k, v] of Object.entries(r.agentAccess)) {
            if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
                agentAccess[k] = v;
            }
        }
    }
    return {
        defaultMemoryScope,
        ...(agentAccess && Object.keys(agentAccess).length > 0 ? { agentAccess } : {}),
    };
}
function parseSmartExtraction(input) {
    if (input === undefined || input === null) {
        return { ...DEFAULT_SMART_EXTRACTION };
    }
    if (typeof input !== "object" || Array.isArray(input)) {
        throw new Error("smartExtraction config must be an object");
    }
    const r = input;
    assertAllowedKeys(r, ["enabled"], "smartExtraction config");
    return {
        enabled: r.enabled === true,
    };
}
const TOP_LEVEL_KEYS = [
    "embedding",
    "dreaming",
    "dbPath",
    "sqlitePath",
    "autoCapture",
    "autoRecall",
    "autoRecallTimeoutMs",
    "captureMaxChars",
    "recallMaxChars",
    "retrieval",
    "rerank",
    "adaptive",
    "decay",
    "scopes",
    "smartExtraction",
];
export const memoryConfigSchema = {
    parse(value, opts) {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("memory config required");
        }
        const cfg = value;
        assertAllowedKeys(cfg, [...TOP_LEVEL_KEYS], "memory config");
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
        const autoRecallTimeoutMs = typeof cfg.autoRecallTimeoutMs === "number" && Number.isFinite(cfg.autoRecallTimeoutMs)
            ? Math.floor(Math.min(120_000, Math.max(500, cfg.autoRecallTimeoutMs)))
            : DEFAULT_AUTO_RECALL_TIMEOUT_MS;
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
            dbPath: dbPathRaw.length > 0 ? dbPathRaw : resolveDefaultDbPath(opts?.agentId ?? "main"),
            sqlitePath: sqlitePathRaw.length > 0
                ? sqlitePathRaw
                : resolveDefaultSqlitePath(opts?.agentId ?? "main"),
            autoCapture: cfg.autoCapture === true,
            autoRecall: cfg.autoRecall !== false,
            autoRecallTimeoutMs,
            captureMaxChars: captureMaxChars ?? DEFAULT_CAPTURE_MAX_CHARS,
            recallMaxChars: recallMaxChars ?? DEFAULT_RECALL_MAX_CHARS,
            retrieval: parseRetrieval(cfg.retrieval),
            rerank: parseRerank(cfg.rerank),
            adaptive: parseAdaptive(cfg.adaptive),
            decay: parseDecay(cfg.decay),
            scopes: parseScopes(cfg.scopes),
            smartExtraction: parseSmartExtraction(cfg.smartExtraction),
        };
    },
};
//# sourceMappingURL=config.js.map