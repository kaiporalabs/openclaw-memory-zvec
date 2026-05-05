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
    /**
     * Optional explicit SQLite store path for FTS + chunk metadata.
     * When omitted, defaults to `~/.openclaw/memory/<agentId>.sqlite` to match OpenClaw builtin.
     */
    sqlitePath?: string;
    autoCapture?: boolean;
    autoRecall?: boolean;
    captureMaxChars?: number;
    recallMaxChars?: number;
};
export declare const MEMORY_CATEGORIES: readonly ["preference", "fact", "decision", "entity", "other"];
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export declare const DEFAULT_CAPTURE_MAX_CHARS = 500;
export declare const DEFAULT_RECALL_MAX_CHARS = 1000;
export declare function resolveDefaultDbPath(): string;
/** Default SQLite path for chunk metadata + FTS (`~/.openclaw/memory/<agentId>.sqlite`). */
export declare function resolveDefaultSqlitePath(agentId: string): string;
export declare function vectorDimsForModel(model: string): number;
export declare const memoryConfigSchema: {
    parse(value: unknown, opts?: {
        agentId?: string;
    }): MemoryConfig;
};
//# sourceMappingURL=config.d.ts.map