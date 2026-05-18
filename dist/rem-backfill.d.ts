export type RemBackfillResult = {
    ok: boolean;
    staged: number;
    filesScanned: number;
    rolledBack: number;
    message: string;
};
export declare function runRemBackfill(params: {
    workspaceDir: string;
    memoryPath?: string;
    stageShortTerm?: boolean;
    rollback?: boolean;
    rollbackShortTerm?: boolean;
    nowMs?: number;
    timezone?: string;
}): Promise<RemBackfillResult>;
//# sourceMappingURL=rem-backfill.d.ts.map