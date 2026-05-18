import type { DatabaseSync } from "node:sqlite";
export type ChunkRow = {
    id: string;
    relPath: string;
    startLine: number;
    endLine: number;
    text: string;
    updatedAtMs: number;
    /** Access scope for isolation (default `global`) */
    scope?: string;
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
export declare function migrateMemoryChunksSchema(db: DatabaseSync): void;
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
/** Remove SQLite + FTS rows for a file and drop its file-state row. Returns removed chunk ids. */
export declare function deleteFileIndex(db: DatabaseSync, relPath: string): string[];
export declare function listIndexedRelPaths(db: DatabaseSync): string[];
/** Chunks overlapping a 1-based line window (for memory_get when the file is missing on disk). */
export declare function getIndexedChunksForLineRange(db: DatabaseSync, params: {
    relPath: string;
    from: number;
    lines: number;
}): ChunkRow[];
export declare function deleteChunkById(db: DatabaseSync, id: string): boolean;
export declare function upsertChunk(db: DatabaseSync, chunk: ChunkRow): void;
export declare function getChunkById(db: DatabaseSync, id: string): ChunkRow | null;
export type FtsHitRow = ChunkSnippetRow & {
    bm25: number;
};
export declare function searchFts(db: DatabaseSync, params: {
    query: string;
    limit: number;
    scopes?: string[];
}): FtsHitRow[];
/** Export all chunks for backup / import workflows */
export declare function listAllChunks(db: DatabaseSync): ChunkRow[];
export declare function stats(db: DatabaseSync): SqliteMemoryStats;
//# sourceMappingURL=sqlite-store.d.ts.map