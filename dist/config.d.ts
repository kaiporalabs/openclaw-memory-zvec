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
    autoCapture?: boolean;
    autoRecall?: boolean;
    captureMaxChars?: number;
    recallMaxChars?: number;
};
export declare const MEMORY_CATEGORIES: readonly ["preference", "fact", "decision", "entity", "other"];
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export declare const DEFAULT_CAPTURE_MAX_CHARS = 500;
export declare const DEFAULT_RECALL_MAX_CHARS = 1000;
export declare function vectorDimsForModel(model: string): number;
export declare const memoryConfigSchema: {
    parse(value: unknown): MemoryConfig;
};
//# sourceMappingURL=config.d.ts.map