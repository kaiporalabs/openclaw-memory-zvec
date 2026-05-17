import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync as SqliteDatabaseSync } from "node:sqlite";
function nowMs() {
    return Date.now();
}
function ensureDirForFile(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
function sha1(input) {
    return createHash("sha1").update(input).digest("hex");
}
export function openMemorySqlite(params) {
    ensureDirForFile(params.sqlitePath);
    const db = new SqliteDatabaseSync(params.sqlitePath);
    db.exec("PRAGMA journal_mode=WAL;");
    db.exec("PRAGMA synchronous=NORMAL;");
    db.exec("PRAGMA temp_store=MEMORY;");
    db.exec("PRAGMA foreign_keys=ON;");
    return db;
}
export function migrateMemoryChunksSchema(db) {
    try {
        db.exec(`ALTER TABLE memory_chunks ADD COLUMN scope TEXT NOT NULL DEFAULT 'global';`);
    }
    catch {
        // Column already exists
    }
}
export function initMemorySchema(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS memory_files (
      rel_path TEXT PRIMARY KEY,
      mtime_ms INTEGER NOT NULL,
      size_bytes INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);
    db.exec(`
    CREATE TABLE IF NOT EXISTS memory_chunks (
      id TEXT PRIMARY KEY,
      rel_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      text TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);
    // FTS5 index for keyword/hybrid search.
    db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts USING fts5(
      id UNINDEXED,
      rel_path,
      text,
      content='',
      tokenize='unicode61'
    );
  `);
    db.exec(`
    CREATE INDEX IF NOT EXISTS memory_chunks_by_path ON memory_chunks(rel_path, start_line);
  `);
    migrateMemoryChunksSchema(db);
}
export function computeChunkId(params) {
    return sha1(`${params.relPath}\n${params.startLine}:${params.endLine}\n${params.text.slice(0, 4096)}`);
}
export function upsertFileState(db, params) {
    const t = nowMs();
    db.prepare(`
    INSERT INTO memory_files (rel_path, mtime_ms, size_bytes, updated_at_ms)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(rel_path) DO UPDATE SET
      mtime_ms=excluded.mtime_ms,
      size_bytes=excluded.size_bytes,
      updated_at_ms=excluded.updated_at_ms;
    `).run(params.relPath, params.mtimeMs, params.sizeBytes, t);
}
export function fileState(db, relPath) {
    const row = db
        .prepare(`SELECT mtime_ms AS mtimeMs, size_bytes AS sizeBytes FROM memory_files WHERE rel_path = ?`)
        .get(relPath);
    if (!row)
        return null;
    const mtimeMs = typeof row.mtimeMs === "bigint" ? Number(row.mtimeMs) : (row.mtimeMs ?? 0);
    const sizeBytes = typeof row.sizeBytes === "bigint" ? Number(row.sizeBytes) : (row.sizeBytes ?? 0);
    return { mtimeMs, sizeBytes };
}
export function deleteChunksForFile(db, relPath) {
    const ids = db
        .prepare(`SELECT id FROM memory_chunks WHERE rel_path = ?`)
        .all(relPath);
    db.prepare(`DELETE FROM memory_chunks WHERE rel_path = ?`).run(relPath);
    for (const row of ids) {
        db.prepare(`DELETE FROM memory_chunks_fts WHERE id = ?`).run(row.id);
    }
}
export function deleteChunkById(db, id) {
    const row = getChunkById(db, id);
    if (!row) {
        return false;
    }
    db.prepare(`DELETE FROM memory_chunks WHERE id = ?`).run(id);
    db.prepare(`DELETE FROM memory_chunks_fts WHERE id = ?`).run(id);
    return true;
}
export function upsertChunk(db, chunk) {
    const scope = chunk.scope ?? "global";
    db.prepare(`
    INSERT INTO memory_chunks (id, rel_path, start_line, end_line, text, updated_at_ms, scope)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      rel_path=excluded.rel_path,
      start_line=excluded.start_line,
      end_line=excluded.end_line,
      text=excluded.text,
      updated_at_ms=excluded.updated_at_ms,
      scope=excluded.scope;
    `).run(chunk.id, chunk.relPath, chunk.startLine, chunk.endLine, chunk.text, chunk.updatedAtMs, scope);
    // Keep the FTS content in sync.
    db.prepare(`
    INSERT INTO memory_chunks_fts (id, rel_path, text)
    VALUES (?, ?, ?);
    `).run(chunk.id, chunk.relPath, chunk.text);
}
export function getChunkById(db, id) {
    const row = db
        .prepare(`SELECT id, rel_path as relPath, start_line as startLine, end_line as endLine, text, updated_at_ms as updatedAtMs,
              scope as scope
       FROM memory_chunks
       WHERE id = ?`)
        .get(id);
    if (!row)
        return null;
    return {
        id: row.id,
        relPath: row.relPath,
        startLine: row.startLine,
        endLine: row.endLine,
        text: row.text,
        updatedAtMs: typeof row.updatedAtMs === "bigint" ? Number(row.updatedAtMs) : row.updatedAtMs,
        ...(row.scope ? { scope: row.scope } : { scope: "global" }),
    };
}
export function searchFts(db, params) {
    const scopes = params.scopes?.filter((s) => s.length > 0) ?? [];
    const scopeClause = scopes.length > 0 ? `AND c.scope IN (${scopes.map(() => "?").join(", ")})` : "";
    // `bm25()` lower is better; normalized later in retrieval pipeline.
    const rows = db
        .prepare(`
      SELECT c.id,
             c.rel_path AS relPath,
             c.start_line AS startLine,
             c.end_line AS endLine,
             snippet(memory_chunks_fts, 2, '[', ']', '…', 12) AS snippet,
             bm25(memory_chunks_fts) AS bm25
        FROM memory_chunks_fts
        JOIN memory_chunks c ON c.id = memory_chunks_fts.id
       WHERE memory_chunks_fts MATCH ?
       ${scopeClause}
       ORDER BY bm25 ASC
       LIMIT ?;
      `)
        .all(...(scopes.length > 0 ? [params.query, ...scopes, params.limit] : [params.query, params.limit]));
    return rows.map((r) => ({
        id: r.id,
        relPath: r.relPath,
        startLine: r.startLine,
        endLine: r.endLine,
        snippet: r.snippet,
        updatedAtMs: 0,
        bm25: typeof r.bm25 === "bigint" ? Number(r.bm25) : r.bm25,
    }));
}
/** Export all chunks for backup / import workflows */
export function listAllChunks(db) {
    const rows = db
        .prepare(`SELECT id, rel_path AS relPath, start_line AS startLine, end_line AS endLine,
              text, updated_at_ms AS updatedAtMs, scope AS scope
       FROM memory_chunks`)
        .all();
    return rows.map((r) => ({
        id: r.id,
        relPath: r.relPath,
        startLine: r.startLine,
        endLine: r.endLine,
        text: r.text,
        updatedAtMs: typeof r.updatedAtMs === "bigint" ? Number(r.updatedAtMs) : r.updatedAtMs,
        scope: r.scope ?? "global",
    }));
}
export function stats(db) {
    const fileRow = db.prepare(`SELECT COUNT(*) AS c FROM memory_files`).get();
    const chunkRow = db.prepare(`SELECT COUNT(*) AS c FROM memory_chunks`).get();
    const files = typeof fileRow?.c === "bigint" ? Number(fileRow.c) : Number(fileRow?.c ?? 0);
    const chunks = typeof chunkRow?.c === "bigint" ? Number(chunkRow.c) : Number(chunkRow?.c ?? 0);
    // Minimal dirty signal: always false; real `memory-core` tracks in-progress indexing.
    return { files, chunks, dirty: false };
}
//# sourceMappingURL=sqlite-store.js.map