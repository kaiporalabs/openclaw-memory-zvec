export type MemoryConfig = {
    embedding: {
        provider: string;
        model: string;
        apiKey?: string;
        baseUrl?: string;
        dimensions?: number;
    };
    dreaming?: Record<string, unknown>;
    dbPath?: string;
    sqlitePath?: string;
    autoCapture?: boolean;
    autoRecall?: boolean;
    /** Timeout for automatic recall injection (ms) */
    autoRecallTimeoutMs?: number;
    captureMaxChars?: number;
    recallMaxChars?: number;
    retrieval: ResolvedRetrievalConfig;
    rerank: ResolvedRerankConfig;
    adaptive: ResolvedAdaptiveConfig;
    scopes: ResolvedScopesConfig;
    decay: ResolvedDecayConfig;
    smartExtraction: ResolvedSmartExtractionConfig;
};
export type ResolvedRetrievalConfig = {
    mode: "hybrid" | "vector" | "fts";
    vectorWeight: number;
    ftsWeight: number;
    minScore: number;
    hardMinScore: number;
    mmrEnabled: boolean;
    mmrLambda: number;
    mmrPoolSize: number;
};
export type ResolvedRerankConfig = {
    enabled: boolean;
    endpoint: string;
    apiKey?: string;
    model: string;
    candidatePoolSize: number;
    timeoutMs: number;
    /** 0–1 portion of final score from reranker (rest from fusion) */
    rerankBlendWeight: number;
};
export type ResolvedAdaptiveConfig = {
    enabled: boolean;
    minCharsEn: number;
    minCharsCjk: number;
};
export type ResolvedDecayConfig = {
    enabled: boolean;
    halfLifeDays: number;
    /** How strongly decay blends with fused score (0 = off even if enabled flag confusing — use enabled) */
    blendWeight: number;
};
export type ResolvedScopesConfig = {
    /** Scope written for indexed workspace chunks */
    defaultMemoryScope: string;
    /** Optional map agentId -> allowed scope strings for search */
    agentAccess?: Record<string, string[]>;
};
export type ResolvedSmartExtractionConfig = {
    enabled: boolean;
};
export declare const MEMORY_CATEGORIES: readonly ["preference", "fact", "decision", "entity", "other"];
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export declare const DEFAULT_CAPTURE_MAX_CHARS = 500;
export declare const DEFAULT_RECALL_MAX_CHARS = 1000;
export declare const DEFAULT_AUTO_RECALL_TIMEOUT_MS = 15000;
export declare const DEFAULT_RETRIEVAL: ResolvedRetrievalConfig;
export declare const DEFAULT_RERANK: ResolvedRerankConfig;
export declare const DEFAULT_ADAPTIVE: ResolvedAdaptiveConfig;
export declare const DEFAULT_DECAY: ResolvedDecayConfig;
export declare const DEFAULT_SCOPES: ResolvedScopesConfig;
export declare const DEFAULT_SMART_EXTRACTION: ResolvedSmartExtractionConfig;
export declare function resolveDefaultDbPath(agentId?: string): string;
export declare function resolveDefaultSqlitePath(agentId: string): string;
export declare function vectorDimsForModel(model: string): number;
export declare const memoryConfigSchema: {
    parse(value: unknown, opts?: {
        agentId?: string;
    }): MemoryConfig;
};
//# sourceMappingURL=config.d.ts.map