import type { MemoryEmbeddingProbeResult, MemoryReadResult, MemorySearchManager, MemorySearchResult, MemorySearchRuntimeDebug, MemorySource, MemoryProviderStatus } from "openclaw/plugin-sdk/memory-core-host-engine-storage";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import { type PathProbeResult } from "./status-self-test.js";
import type { Embeddings } from "./embeddings.js";
import type { MemoryConfig } from "./config.js";
import { MemoryZvecStore } from "./zvec-store.js";
import type { ChunkRow } from "./sqlite-store.js";
export type MemoryZvecStatusSelfTest = {
    checkedAtMs: number;
    overallOk: boolean;
    embeddingEndpointSummary: string;
    workspaceDir: PathProbeResult;
    sqlitePath: PathProbeResult;
    zvecDataRoot: PathProbeResult;
    /** Workspace-relative memory corpus roots that exist (e.g. `MEMORY.md`, `memory`). */
    memoryCorpusRootsPresent: string[];
    zvecCollection: {
        ok: boolean;
        docCount?: number;
        error?: string;
    };
    embedding: MemoryEmbeddingProbeResult;
    sqlite: {
        ok: boolean;
        files?: number;
        chunks?: number;
        error?: string;
    };
    notes: string[];
};
export declare class ZvecSqliteMemoryManager implements MemorySearchManager {
    private readonly cfg;
    private readonly workspaceDir;
    private readonly agentId;
    private readonly embeddings;
    private readonly zvec;
    private readonly pluginLog?;
    private db;
    private initialized;
    private lastEmbedProbe;
    private statusSelfTest;
    constructor(cfg: MemoryConfig, workspaceDir: string, agentId: string, embeddings: Embeddings, zvec: MemoryZvecStore, pluginLog?: PluginLogger | undefined);
    private ensureInitialized;
    status(): MemoryProviderStatus;
    /**
     * Deep checks for `purpose: "status"` (Control UI / `doctor.memory.status`): paths on disk,
     * SQLite/FTS stats, Zvec collection reachability, embedding provider ping. Results appear under
     * `status().custom.memoryZvecStatusSelfTest`.
     */
    runStatusSelfTest(): Promise<void>;
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
    /** Export chunks + metadata for backup / migration */
    exportChunksSnapshot(): {
        formatVersion: 1;
        exportedAt: string;
        agentId: string;
        chunks: ChunkRow[];
    };
    /** Re-embed every SQLite chunk into Zvec (expensive). */
    reembedAll(params?: {
        batchPauseMs?: number;
    }): Promise<{
        updated: number;
    }>;
    /** Apply snapshot produced by `exportChunksSnapshot` (upserts SQLite + Zvec). */
    applyChunksSnapshot(chunks: ChunkRow[]): Promise<{
        imported: number;
    }>;
    readFile(params: {
        relPath: string;
        from?: number;
        lines?: number;
    }): Promise<MemoryReadResult>;
}
//# sourceMappingURL=memory-manager.d.ts.map