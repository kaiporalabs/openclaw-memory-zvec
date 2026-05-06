import type { ChunkSnippetRow } from "./sqlite-store.js";
export type FusedCandidate = {
    id: string;
    vectorScore?: number;
    ftsScore?: number;
    bm25Raw?: number;
    fusedScore: number;
};
/** BM25 from SQLite FTS: lower is better → normalize within batch to [0,1] */
export declare function bm25BatchToScores(rows: Array<{
    id: string;
    bm25: number;
}>): Map<string, number>;
export declare function fuseHybridScores(params: {
    ids: Set<string>;
    vectorById: Map<string, number>;
    ftsById: Map<string, number>;
    vectorWeight: number;
    ftsWeight: number;
    mode: "hybrid" | "vector" | "fts";
}): Map<string, number>;
export declare function applyTimeDecay(params: {
    fusedScore: number;
    updatedAtMs: number;
    halfLifeDays: number;
    weight: number;
}): number;
export declare function maximalMarginalRelevance(params: {
    candidates: Array<{
        id: string;
        text: string;
        score: number;
    }>;
    maxResults: number;
    lambda: number;
}): string[];
export type ChunkSnippetWithBm25 = ChunkSnippetRow & {
    bm25: number;
};
//# sourceMappingURL=retrieval-pipeline.d.ts.map