/** Heuristics inspired by production hybrid-memory plugins: skip cheap prompts, force memory-heavy prompts. */
export type AdaptiveRetrievalInput = {
    query: string;
    /** When false, adaptive layer is bypassed */
    enabled: boolean;
    /** Minimum Latin-ish prompt length */
    minCharsEn: number;
    /** Minimum length for CJK-heavy prompts */
    minCharsCjk: number;
};
export declare function shouldSkipAdaptiveRecall(params: AdaptiveRetrievalInput): boolean;
//# sourceMappingURL=adaptive-retrieval.d.ts.map