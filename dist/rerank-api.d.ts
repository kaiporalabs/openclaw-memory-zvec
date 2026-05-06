export type JinaRerankResponse = {
    results?: Array<{
        index?: number;
        relevance_score?: number;
        score?: number;
    }>;
    data?: Array<{
        index?: number;
        relevance_score?: number;
        score?: number;
    }>;
};
export declare function rerankWithJinaCompatible(params: {
    endpoint: string;
    apiKey?: string;
    model: string;
    query: string;
    documents: string[];
    timeoutMs: number;
}): Promise<Array<{
    index: number;
    score: number;
}>>;
//# sourceMappingURL=rerank-api.d.ts.map