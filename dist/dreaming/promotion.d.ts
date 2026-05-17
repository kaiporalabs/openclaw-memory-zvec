import type { ChunkRow } from "../sqlite-store.js";
import type { ZvecDreamingRuntimeConfig } from "./config.js";
export type DreamingPromotionCandidate = {
    chunk: ChunkRow;
    score: number;
};
export declare function scoreChunkRecency(params: {
    updatedAtMs: number;
    nowMs: number;
    halfLifeDays: number;
}): number;
export declare function rankDreamingCandidates(params: {
    chunks: ChunkRow[];
    nowMs: number;
    config: Pick<ZvecDreamingRuntimeConfig, "maxAgeDays" | "recencyHalfLifeDays" | "limit">;
}): DreamingPromotionCandidate[];
export declare function applyDreamingPromotions(params: {
    workspaceDir: string;
    candidates: DreamingPromotionCandidate[];
    config: ZvecDreamingRuntimeConfig;
    nowMs: number;
}): Promise<{
    applied: number;
    reportLines: string[];
}>;
//# sourceMappingURL=promotion.d.ts.map