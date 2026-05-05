import type { DatabaseSync } from "node:sqlite";
export type ChunkRow = {
    id: string;
    relPath: string;
    startLine: number;
    endLine: number;
    text: string;
    updatedAtMs: number;
};
export type ChunkSnippetRow = Omit<ChunkRow, "text"> & {
    snippet: string;
};
export type SqliteMemoryStats = {
    files: number;
    chunks: number;
    dirty: boolean;
};
export declare function openMemorySqlite(params: {
    sqlitePath: string;
}): DatabaseSync;
export declare function initMemorySchema(db: DatabaseSync): void;
export declare function computeChunkId(params: {
    relPath: string;
    startLine: number;
    endLine: number;
    text: string;
}): string;
export declare function upsertFileState(db: DatabaseSync, params: {
    relPath: string;
    mtimeMs: number;
    sizeBytes: number;
}): void;
export declare function fileState(db: DatabaseSync, relPath: string): {
    mtimeMs: number;
    sizeBytes: number;
} | null;
export declare function deleteChunksForFile(db: DatabaseSync, relPath: string): void;
export declare function upsertChunk(db: DatabaseSync, chunk: ChunkRow): void;
export declare function getChunkById(db: DatabaseSync, id: string): ChunkRow | null;
export declare function searchFts(db: DatabaseSync, params: {
    query: string;
    limit: number;
}): ChunkSnippetRow[];
export declare function stats(db: DatabaseSync): SqliteMemoryStats;
//# sourceMappingURL=sqlite-store.d.ts.map