import type { MemorySearchResult } from "openclaw/plugin-sdk/memory-core-host-runtime-files";
import type { ChunkRow } from "./sqlite-store.js";
import type { DreamingPromotionCandidate } from "./dreaming/promotion.js";
export type ShortTermRecallEntry = {
    key: string;
    path: string;
    startLine: number;
    endLine: number;
    source: "memory";
    snippet: string;
    recallCount: number;
    dailyCount: number;
    groundedCount: number;
    totalScore: number;
    maxScore: number;
    firstRecalledAt: string;
    lastRecalledAt: string;
    queryHashes: string[];
    recallDays: string[];
    conceptTags: string[];
    promotedAt?: string;
};
export type RecallPromotionRankConfig = {
    limit: number;
    minScore: number;
    minRecallCount: number;
    minUniqueQueries: number;
    recencyHalfLifeDays: number;
    maxAgeDays?: number;
    timezone?: string;
};
export declare function isShortTermMemoryPath(relPath: string): boolean;
export declare function recordShortTermRecalls(params: {
    workspaceDir: string;
    query: string;
    results: MemorySearchResult[];
    nowMs?: number;
    timezone?: string;
    dedupeByQueryPerDay?: boolean;
}): Promise<void>;
export declare function rankRecallPromotionCandidates(params: {
    workspaceDir: string;
    chunks: ChunkRow[];
    config: RecallPromotionRankConfig;
    nowMs?: number;
}): Promise<DreamingPromotionCandidate[]>;
export declare function recordManagerRecalls(params: {
    workspaceDir: string;
    query: string;
    results: MemorySearchResult[];
    timezone?: string;
}): Promise<void>;
export declare function markRecallEntriesPromoted(params: {
    workspaceDir: string;
    candidates: DreamingPromotionCandidate[];
    nowMs?: number;
}): Promise<void>;
//# sourceMappingURL=recall-store.d.ts.map