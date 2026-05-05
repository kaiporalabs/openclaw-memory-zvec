import type { MemoryEmbeddingProbeResult, MemoryReadResult, MemorySearchManager, MemorySearchResult, MemorySearchRuntimeDebug, MemorySource, MemoryProviderStatus } from "openclaw/plugin-sdk/memory-core-host-engine-storage";
import type { Embeddings } from "./embeddings.js";
import type { MemoryConfig } from "./config.js";
import { MemoryZvecStore } from "./zvec-store.js";
export declare class ZvecSqliteMemoryManager implements MemorySearchManager {
    private readonly cfg;
    private readonly workspaceDir;
    private readonly agentId;
    private readonly embeddings;
    private readonly zvec;
    private db;
    private initialized;
    private lastEmbedProbe;
    constructor(cfg: MemoryConfig, workspaceDir: string, agentId: string, embeddings: Embeddings, zvec: MemoryZvecStore);
    private ensureInitialized;
    status(): MemoryProviderStatus;
    probeVectorAvailability(): Promise<boolean>;
    getCachedEmbeddingAvailability(): MemoryEmbeddingProbeResult | null;
    probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult>;
    close(): Promise<void>;
    sync(params?: {
        reason?: string;
        force?: boolean;
    }): Promise<void>;
    search(query: string, opts?: {
        maxResults?: number;
        minScore?: number;
        sessionKey?: string;
        qmdSearchModeOverride?: "query" | "search" | "vsearch";
        onDebug?: (debug: MemorySearchRuntimeDebug) => void;
        sources?: MemorySource[];
    }): Promise<MemorySearchResult[]>;
    readFile(params: {
        relPath: string;
        from?: number;
        lines?: number;
    }): Promise<MemoryReadResult>;
}
//# sourceMappingURL=memory-manager.d.ts.map