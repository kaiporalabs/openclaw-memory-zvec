export type PathProbeResult = {
    path: string;
    ok: boolean;
    kind: "file" | "directory" | "missing" | "unknown";
    error?: string;
};
export declare function probeFilesystemPath(absPath: string): Promise<PathProbeResult>;
export declare function computeStatusOverallOk(parts: {
    workspaceDir: PathProbeResult;
    sqlitePath: PathProbeResult;
    zvecDataRoot: PathProbeResult;
    zvecCollectionOk: boolean;
    embeddingOk: boolean;
    sqliteStatsOk: boolean;
}): boolean;
//# sourceMappingURL=status-self-test.d.ts.map