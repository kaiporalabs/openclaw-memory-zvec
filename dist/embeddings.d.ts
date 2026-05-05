import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import type { MemoryConfig } from "./config.js";
export type Embeddings = {
    embed(text: string, options?: {
        timeoutMs?: number;
    }): Promise<number[]>;
};
export declare function normalizeEmbeddingVector(value: unknown): number[];
export declare function createEmbeddings(api: OpenClawPluginApi, cfg: MemoryConfig): Embeddings;
//# sourceMappingURL=embeddings.d.ts.map