/**
 * Hybrid memory search: SQLite + FTS for chunk metadata, Zvec for dense vectors, optional
 * `pluginLog` (OpenClaw `api.logger`) for operational warnings — sync failures, vector-search leg
 * failures (FTS fallback), and rich embedding probe errors via `formatErrorDiagnostic`.
 *
 * Diagnostics env vars for extra debug lines live in `debug-env.ts` / README “Diagnostics & logging”.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describeEmbeddingEndpoint, formatErrorDiagnostic } from "./error-diagnostic.js";
import { computeStatusOverallOk, probeFilesystemPath, } from "./status-self-test.js";
import { normalizeRecallQuery } from "./prompt-helpers.js";
import { MemoryZvecStore } from "./zvec-store.js";
import { shouldSkipAdaptiveRecall } from "./adaptive-retrieval.js";
import { applyTimeDecay, bm25BatchToScores, fuseHybridScores, maximalMarginalRelevance, } from "./retrieval-pipeline.js";
import { rerankWithJinaCompatible } from "./rerank-api.js";
import { isScopeAllowed, resolveAllowedScopes } from "./scopes.js";
import { computeChunkId, deleteChunkById, deleteChunksForFile, deleteFileIndex, fileState, getChunkById, getIndexedChunksForLineRange, initMemorySchema, listAllChunks, listIndexedRelPaths, openMemorySqlite, searchFts, stats as sqliteStats, upsertChunk, upsertFileState, } from "./sqlite-store.js";
function looksIndexableFile(relPath) {
    const lower = relPath.toLowerCase();
    if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".markdown"))
        return true;
    return relPath === "MEMORY.md" || relPath === "USER.md" || relPath === "IDENTITY.md";
}
async function listMemoryRoots(workspaceDir) {
    const roots = ["MEMORY.md", "USER.md", "IDENTITY.md", "memory"];
    const out = [];
    for (const r of roots) {
        const abs = path.join(workspaceDir, r);
        try {
            await fsp.stat(abs);
            out.push(r);
        }
        catch {
            // ignore
        }
    }
    return out;
}
async function crawlFiles(workspaceDir) {
    const roots = await listMemoryRoots(workspaceDir);
    const files = [];
    for (const root of roots) {
        const absRoot = path.join(workspaceDir, root);
        const st = await fsp.stat(absRoot);
        if (st.isFile()) {
            files.push(root);
            continue;
        }
        if (!st.isDirectory())
            continue;
        const stack = [root];
        while (stack.length) {
            const relDir = stack.pop();
            const absDir = path.join(workspaceDir, relDir);
            const entries = await fsp.readdir(absDir, { withFileTypes: true });
            for (const ent of entries) {
                if (ent.name.startsWith("."))
                    continue;
                const rel = path.join(relDir, ent.name);
                if (ent.isDirectory()) {
                    stack.push(rel);
                    continue;
                }
                if (ent.isFile() && looksIndexableFile(rel)) {
                    files.push(rel);
                }
            }
        }
    }
    files.sort();
    return files;
}
function chunkTextByLines(params) {
    const lines = params.text.split(/\r?\n/);
    const chunks = [];
    let buf = [];
    let startLine = 1;
    let bufChars = 0;
    const flush = (endLine) => {
        const body = buf.join("\n").trim();
        buf = [];
        bufChars = 0;
        if (!body)
            return;
        const id = computeChunkId({ relPath: params.relPath, startLine, endLine, text: body });
        chunks.push({ id, relPath: params.relPath, startLine, endLine, text: body });
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const nextChars = bufChars + line.length + 1;
        if (buf.length > 0 && nextChars > params.maxChars) {
            flush(i);
            startLine = i + 1;
        }
        buf.push(line);
        bufChars = nextChars;
    }
    flush(lines.length);
    return chunks;
}
function isProbeableFilesystemPath(p) {
    const t = p.trim();
    if (!t) {
        return false;
    }
    if (t.includes("://") && !t.startsWith("file:")) {
        return false;
    }
    return true;
}
function toFilesystemAbsolutePath(p) {
    const t = p.trim();
    if (t.startsWith("file:")) {
        try {
            return fileURLToPath(new URL(t));
        }
        catch {
            return t;
        }
    }
    return t;
}
export class ZvecSqliteMemoryManager {
    cfg;
    workspaceDir;
    agentId;
    embeddings;
    zvec;
    pluginLog;
    db;
    initialized = false;
    indexDirty = false;
    lastEmbedProbe = null;
    statusSelfTest = null;
    constructor(cfg, workspaceDir, agentId, embeddings, zvec, pluginLog) {
        this.cfg = cfg;
        this.workspaceDir = workspaceDir;
        this.agentId = agentId;
        this.embeddings = embeddings;
        this.zvec = zvec;
        this.pluginLog = pluginLog;
        this.db = openMemorySqlite({ sqlitePath: cfg.sqlitePath });
    }
    ensureInitialized() {
        if (this.initialized)
            return;
        initMemorySchema(this.db);
        this.initialized = true;
    }
    status() {
        this.ensureInitialized();
        const st = sqliteStats(this.db);
        const selfTest = this.statusSelfTest;
        const zvecOk = selfTest?.zvecCollection.ok ?? true;
        const embedOk = selfTest?.embedding.ok ?? true;
        const ftsOk = selfTest?.sqlite.ok ?? true;
        let vectorLoadError;
        if (selfTest) {
            if (!selfTest.embedding.ok && selfTest.embedding.error) {
                vectorLoadError = `embeddings: ${selfTest.embedding.error}`;
            }
            else if (!selfTest.zvecCollection.ok && selfTest.zvecCollection.error) {
                vectorLoadError = `zvec: ${selfTest.zvecCollection.error}`;
            }
        }
        return {
            backend: "builtin",
            provider: this.cfg.embedding.provider,
            model: this.cfg.embedding.model,
            files: st.files,
            chunks: st.chunks,
            dirty: this.indexDirty,
            workspaceDir: this.workspaceDir,
            dbPath: this.cfg.sqlitePath,
            sources: ["memory"],
            fts: {
                enabled: true,
                available: ftsOk,
                ...(selfTest?.sqlite.error ? { error: selfTest.sqlite.error } : {}),
            },
            vector: {
                enabled: true,
                available: selfTest ? zvecOk && embedOk : true,
                ...(vectorLoadError ? { loadError: vectorLoadError } : {}),
                dims: this.cfg.embedding.dimensions,
            },
            custom: {
                zvecDataRoot: this.cfg.dbPath,
                sqliteChunks: st.chunks,
                ...(selfTest?.zvecCollection.docCount !== undefined
                    ? { zvecDocCount: selfTest.zvecCollection.docCount }
                    : {}),
                ...(selfTest ? { memoryZvecStatusSelfTest: selfTest } : {}),
                ...(!selfTest ? { embeddingEndpointSummary: describeEmbeddingEndpoint(this.cfg.embedding) } : {}),
            },
        };
    }
    /**
     * Deep checks for `purpose: "status"` (Control UI / `doctor.memory.status`): paths on disk,
     * SQLite/FTS stats, Zvec collection reachability, embedding provider ping. Results appear under
     * `status().custom.memoryZvecStatusSelfTest`.
     */
    async runStatusSelfTest() {
        const checkedAtMs = Date.now();
        const notes = [];
        const workspaceDir = await probeFilesystemPath(this.workspaceDir);
        if (!workspaceDir.ok) {
            notes.push("Workspace directory missing or unreadable; memory file index cannot run.");
        }
        const sp = this.cfg.sqlitePath ?? "";
        let sqlitePath;
        if (!sp.trim()) {
            sqlitePath = { path: "", ok: false, kind: "missing", error: "sqlitePath is empty" };
        }
        else if (!isProbeableFilesystemPath(sp)) {
            sqlitePath = { path: sp, ok: true, kind: "unknown" };
            notes.push("SQLite path uses a non-local URI; filesystem probe skipped.");
        }
        else {
            sqlitePath = await probeFilesystemPath(toFilesystemAbsolutePath(sp));
            if (!sqlitePath.ok) {
                notes.push("SQLite path not found on disk (unexpected after open).");
            }
        }
        const dbp = this.cfg.dbPath ?? "";
        let zvecDataRoot;
        let zvecCollection = { ok: false };
        if (!dbp.trim()) {
            zvecDataRoot = { path: "", ok: false, kind: "missing", error: "dbPath is empty" };
            zvecCollection = { ok: false, error: "dbPath is empty" };
        }
        else if (!isProbeableFilesystemPath(dbp)) {
            zvecDataRoot = { path: dbp, ok: true, kind: "unknown" };
            notes.push("Zvec data root uses a non-local URI; filesystem probe skipped.");
            try {
                const docCount = await this.zvec.count();
                zvecCollection = { ok: true, docCount };
            }
            catch (err) {
                zvecCollection = { ok: false, error: formatErrorDiagnostic(err) };
            }
        }
        else {
            zvecDataRoot = await probeFilesystemPath(toFilesystemAbsolutePath(dbp));
            try {
                const docCount = await this.zvec.count();
                zvecCollection = { ok: true, docCount };
                zvecDataRoot = await probeFilesystemPath(toFilesystemAbsolutePath(dbp));
            }
            catch (err) {
                zvecCollection = { ok: false, error: formatErrorDiagnostic(err) };
            }
        }
        const memoryCorpusRootsPresent = await listMemoryRoots(this.workspaceDir);
        if (memoryCorpusRootsPresent.length === 0) {
            notes.push("No MEMORY.md, USER.md, IDENTITY.md, or memory/ in the workspace yet (OK if you only use tool-stored memories).");
        }
        let sqliteStatsResult = { ok: false };
        try {
            this.ensureInitialized();
            const s = sqliteStats(this.db);
            sqliteStatsResult = { ok: true, files: s.files, chunks: s.chunks };
        }
        catch (err) {
            sqliteStatsResult = { ok: false, error: formatErrorDiagnostic(err) };
        }
        const embedding = await this.probeEmbeddingAvailability();
        const overallOk = computeStatusOverallOk({
            workspaceDir,
            sqlitePath,
            zvecDataRoot,
            zvecCollectionOk: zvecCollection.ok,
            embeddingOk: embedding.ok,
            sqliteStatsOk: sqliteStatsResult.ok,
        });
        this.statusSelfTest = {
            checkedAtMs,
            overallOk,
            embeddingEndpointSummary: describeEmbeddingEndpoint(this.cfg.embedding),
            workspaceDir,
            sqlitePath,
            zvecDataRoot,
            memoryCorpusRootsPresent,
            zvecCollection,
            embedding,
            sqlite: sqliteStatsResult,
            notes,
        };
    }
    async probeVectorAvailability() {
        // If Zvec opened, it's available. We keep this best-effort.
        return true;
    }
    getCachedEmbeddingAvailability() {
        return this.lastEmbedProbe;
    }
    async probeEmbeddingAvailability() {
        const started = Date.now();
        try {
            await this.embeddings.embed("ping");
            this.lastEmbedProbe = { ok: true, checked: true, checkedAtMs: started };
            return this.lastEmbedProbe;
        }
        catch (err) {
            const message = formatErrorDiagnostic(err);
            this.lastEmbedProbe = { ok: false, error: message, checked: true, checkedAtMs: started };
            return this.lastEmbedProbe;
        }
    }
    async close() {
        try {
            this.db.close();
        }
        catch { }
        await this.zvec.close();
    }
    async embedChunkIntoZvec(chunk) {
        try {
            const vec = await this.embeddings.embed(chunk.text);
            await this.zvec.store({
                id: chunk.id,
                text: chunk.text,
                vector: vec,
                importance: 0.5,
                category: "other",
            });
            return true;
        }
        catch (err) {
            this.pluginLog?.warn(`memory-zvec: zvec store failed [agent=${this.agentId}] chunk=${chunk.id}: ${formatErrorDiagnostic(err)}`);
            return false;
        }
    }
    async pruneOrphanIndexedFiles(crawled) {
        let pruned = 0;
        for (const relPath of listIndexedRelPaths(this.db)) {
            if (crawled.has(relPath)) {
                continue;
            }
            const removedIds = deleteFileIndex(this.db, relPath);
            for (const id of removedIds) {
                try {
                    await this.zvec.delete(id);
                }
                catch (err) {
                    this.pluginLog?.warn(`memory-zvec: zvec delete failed [agent=${this.agentId}] orphan id=${id}: ${formatErrorDiagnostic(err)}`);
                }
            }
            pruned++;
        }
        return pruned;
    }
    async reconcileZvecWithSqlite() {
        const sqliteChunks = listAllChunks(this.db);
        const sqliteIds = new Set(sqliteChunks.map((c) => c.id));
        const zvecIds = new Set(this.zvec.listKnownIds());
        let pruned = 0;
        for (const id of zvecIds) {
            if (sqliteIds.has(id)) {
                continue;
            }
            try {
                await this.zvec.delete(id);
                pruned++;
            }
            catch (err) {
                this.pluginLog?.warn(`memory-zvec: zvec delete failed [agent=${this.agentId}] stale id=${id}: ${formatErrorDiagnostic(err)}`);
            }
        }
        let embedded = 0;
        let failed = 0;
        for (const chunk of sqliteChunks) {
            if (zvecIds.has(chunk.id)) {
                continue;
            }
            const ok = await this.embedChunkIntoZvec({
                id: chunk.id,
                relPath: chunk.relPath,
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                text: chunk.text,
            });
            if (ok) {
                embedded++;
            }
            else {
                failed++;
            }
        }
        return { embedded, failed, pruned };
    }
    async sync(params) {
        this.ensureInitialized();
        this.indexDirty = true;
        try {
            await this.runSyncBody(params);
            this.indexDirty = false;
        }
        catch (err) {
            this.pluginLog?.warn?.(`memory-zvec: sync aborted [agent=${this.agentId}]: ${formatErrorDiagnostic(err)}`);
            throw err;
        }
    }
    async runSyncBody(params) {
        const files = await crawlFiles(this.workspaceDir);
        const crawled = new Set(files);
        const memScope = this.cfg.scopes.defaultMemoryScope;
        let embedFailed = 0;
        const prunedFiles = await this.pruneOrphanIndexedFiles(crawled);
        for (const relPath of files) {
            const absPath = path.join(this.workspaceDir, relPath);
            const st = await fsp.stat(absPath);
            const prev = fileState(this.db, relPath);
            if (!params?.force && prev && prev.mtimeMs === st.mtimeMs && prev.sizeBytes === st.size) {
                continue;
            }
            const raw = await fsp.readFile(absPath, "utf8");
            const chunks = chunkTextByLines({ relPath, text: raw, maxChars: 1200 });
            this.db.exec("BEGIN");
            try {
                deleteChunksForFile(this.db, relPath);
                const now = Date.now();
                for (const chunk of chunks) {
                    upsertChunk(this.db, {
                        id: chunk.id,
                        relPath: chunk.relPath,
                        startLine: chunk.startLine,
                        endLine: chunk.endLine,
                        text: chunk.text,
                        updatedAtMs: now,
                        scope: memScope,
                    });
                }
                upsertFileState(this.db, { relPath, mtimeMs: st.mtimeMs, sizeBytes: st.size });
                this.db.exec("COMMIT");
            }
            catch (err) {
                try {
                    this.db.exec("ROLLBACK");
                }
                catch { }
                this.pluginLog?.warn(`memory-zvec: sync failed [agent=${this.agentId}] file=${relPath}: ${formatErrorDiagnostic(err)}`);
                throw err;
            }
            for (const chunk of chunks) {
                const ok = await this.embedChunkIntoZvec(chunk);
                if (!ok) {
                    embedFailed++;
                }
            }
        }
        const reconcile = await this.reconcileZvecWithSqlite();
        const st = sqliteStats(this.db);
        this.pluginLog?.info?.(`memory-zvec: sync complete [agent=${this.agentId}] reason=${params?.reason ?? "open"} files=${st.files} chunks=${st.chunks} prunedFiles=${prunedFiles} zvecEmbedded=${reconcile.embedded} zvecFailed=${embedFailed + reconcile.failed} zvecPruned=${reconcile.pruned}`);
    }
    async forgetLegacyVectorId(id) {
        this.ensureInitialized();
        try {
            await this.zvec.delete(id);
            return true;
        }
        catch {
            return false;
        }
    }
    getWorkspaceDir() {
        return this.workspaceDir;
    }
    async forgetById(id) {
        this.ensureInitialized();
        const deleted = deleteChunkById(this.db, id);
        if (!deleted) {
            return false;
        }
        try {
            await this.zvec.delete(id);
        }
        catch (err) {
            this.pluginLog?.warn(`memory-zvec: zvec delete failed [agent=${this.agentId}] id=${id}: ${formatErrorDiagnostic(err)}`);
        }
        return true;
    }
    resolveChunkIdForSearchHit(hit) {
        const row = this.db
            .prepare(`SELECT id FROM memory_chunks WHERE rel_path = ? AND start_line = ? AND end_line = ? LIMIT 1`)
            .get(hit.path, hit.startLine, hit.endLine);
        return row?.id ?? null;
    }
    async forgetByQuery(query, minScore = 0.7) {
        const results = await this.search(query, { maxResults: 5, minScore });
        if (results.length === 0) {
            return { action: "not_found" };
        }
        if (results.length === 1 && results[0].score > 0.9) {
            const hit = results[0];
            const id = this.resolveChunkIdForSearchHit(hit);
            if (id) {
                await this.forgetById(id);
                return { action: "deleted", id, text: hit.snippet };
            }
        }
        const candidates = results
            .map((r) => {
            const id = this.resolveChunkIdForSearchHit(r);
            return id ? { id, text: r.snippet, score: r.score } : null;
        })
            .filter((c) => c != null);
        return { action: "candidates", candidates };
    }
    async search(query, opts) {
        void opts?.qmdSearchModeOverride;
        this.ensureInitialized();
        const rc = this.cfg.retrieval;
        const maxResults = Math.max(1, Math.floor(opts?.maxResults ?? 8));
        const minScore = typeof opts?.minScore === "number" ? opts.minScore : rc.minScore;
        const hardMin = rc.hardMinScore;
        if (shouldSkipAdaptiveRecall({
            query,
            enabled: this.cfg.adaptive.enabled,
            minCharsEn: this.cfg.adaptive.minCharsEn,
            minCharsCjk: this.cfg.adaptive.minCharsCjk,
        })) {
            return [];
        }
        const allowed = new Set(resolveAllowedScopes(this.cfg, this.agentId));
        const poolLimit = Math.max(rc.mmrPoolSize, maxResults * 4, 24);
        let vectorResults = [];
        try {
            const qVec = await this.embeddings.embed(normalizeRecallQuery(query, this.cfg.recallMaxChars));
            const z = await this.zvec.search(qVec, poolLimit, 0);
            vectorResults = z.map((r) => ({ id: r.entry.id, score: r.score }));
        }
        catch (err) {
            this.pluginLog?.warn(`memory-zvec: vector search leg failed (using FTS only) [agent=${this.agentId}]: ${formatErrorDiagnostic(err)}`);
        }
        let ftsRows = [];
        try {
            ftsRows = searchFts(this.db, {
                query,
                limit: poolLimit,
                scopes: [...allowed],
            });
        }
        catch (err) {
            this.pluginLog?.warn(`memory-zvec: FTS query failed (vector-only for this search) [agent=${this.agentId}]: ${formatErrorDiagnostic(err)}`);
        }
        const ftsNorm = bm25BatchToScores(ftsRows.map((r) => ({ id: r.id, bm25: r.bm25 })));
        const vectorById = new Map(vectorResults.map((v) => [v.id, v.score]));
        const ftsById = ftsNorm;
        const ids = new Set();
        for (const v of vectorResults)
            ids.add(v.id);
        for (const r of ftsRows)
            ids.add(r.id);
        const fusedMap = fuseHybridScores({
            ids,
            vectorById,
            ftsById,
            vectorWeight: rc.vectorWeight,
            ftsWeight: rc.ftsWeight,
            mode: rc.mode,
        });
        const rows = [];
        for (const id of fusedMap.keys()) {
            const chunk = getChunkById(this.db, id);
            if (!chunk)
                continue;
            if (!isScopeAllowed(chunk.scope, allowed))
                continue;
            let fused = fusedMap.get(id) ?? 0;
            if (this.cfg.decay.enabled) {
                fused = applyTimeDecay({
                    fusedScore: fused,
                    updatedAtMs: chunk.updatedAtMs,
                    halfLifeDays: this.cfg.decay.halfLifeDays,
                    weight: this.cfg.decay.blendWeight,
                });
            }
            if (fused < hardMin)
                continue;
            const ftsHit = ftsRows.find((x) => x.id === id);
            rows.push({
                id,
                fused,
                snippet: ftsHit?.snippet,
                vectorScore: vectorById.get(id),
                ftsScore: ftsById.get(id),
            });
        }
        rows.sort((a, b) => b.fused - a.fused);
        let ranked = rows.filter((r) => r.fused >= minScore);
        const rr = this.cfg.rerank;
        if (rr.enabled && rr.endpoint.trim().length > 0 && ranked.length > 1) {
            const k = Math.min(rr.candidatePoolSize, ranked.length);
            const slice = ranked.slice(0, k);
            const docs = slice.map((r) => getChunkById(this.db, r.id)?.text ?? "");
            try {
                const order = await rerankWithJinaCompatible({
                    endpoint: rr.endpoint,
                    apiKey: rr.apiKey,
                    model: rr.model,
                    query,
                    documents: docs,
                    timeoutMs: rr.timeoutMs,
                });
                const maxS = Math.max(1e-6, ...order.map((o) => Math.abs(o.score)));
                const rerankByIdx = new Map(order.map((o) => [o.index, Math.min(1, Math.abs(o.score) / maxS)]));
                const blend = rr.rerankBlendWeight;
                for (let i = 0; i < slice.length; i++) {
                    const rs = rerankByIdx.get(i) ?? 0;
                    slice[i].fused = (1 - blend) * slice[i].fused + blend * rs;
                }
                slice.sort((a, b) => b.fused - a.fused);
                ranked = [...slice, ...ranked.slice(k)].sort((a, b) => b.fused - a.fused);
            }
            catch (err) {
                this.pluginLog?.warn(`memory-zvec: rerank failed (using fusion only) [agent=${this.agentId}]: ${formatErrorDiagnostic(err)}`);
            }
        }
        let orderedIds;
        if (rc.mmrEnabled && ranked.length > 1) {
            const mmrCandidates = ranked.map((r) => ({
                id: r.id,
                text: getChunkById(this.db, r.id)?.text ?? "",
                score: r.fused,
            }));
            orderedIds = maximalMarginalRelevance({
                candidates: mmrCandidates,
                maxResults,
                lambda: rc.mmrLambda,
            });
        }
        else {
            orderedIds = [...ranked].sort((a, b) => b.fused - a.fused).map((r) => r.id);
        }
        const metaById = new Map(ranked.map((r) => [r.id, r]));
        const seen = new Set();
        const out = [];
        for (const id of orderedIds) {
            if (seen.has(id))
                continue;
            seen.add(id);
            const chunk = getChunkById(this.db, id);
            if (!chunk)
                continue;
            const meta = metaById.get(id);
            const ftsHit = ftsRows.find((x) => x.id === id);
            const score = meta?.fused ?? 0;
            if (score < minScore)
                continue;
            out.push({
                path: chunk.relPath,
                startLine: chunk.startLine,
                endLine: chunk.endLine,
                score,
                vectorScore: meta?.vectorScore,
                textScore: meta?.ftsScore,
                snippet: ftsHit?.snippet ?? chunk.text.slice(0, 220),
                source: "memory",
            });
            if (out.length >= maxResults)
                break;
        }
        return out;
    }
    /** Export chunks + metadata for backup / migration */
    exportChunksSnapshot() {
        this.ensureInitialized();
        return {
            formatVersion: 1,
            exportedAt: new Date().toISOString(),
            agentId: this.agentId,
            chunks: listAllChunks(this.db),
        };
    }
    /** Re-embed every SQLite chunk into Zvec (expensive). */
    async reembedAll(params) {
        this.ensureInitialized();
        const chunks = listAllChunks(this.db);
        let updated = 0;
        const pause = params?.batchPauseMs ?? 0;
        for (const ch of chunks) {
            const vec = await this.embeddings.embed(ch.text);
            await this.zvec.store({
                id: ch.id,
                text: ch.text,
                vector: vec,
                importance: 0.5,
                category: "other",
            });
            updated++;
            if (pause > 0) {
                await new Promise((r) => setTimeout(r, pause));
            }
        }
        return { updated };
    }
    /** Apply snapshot produced by `exportChunksSnapshot` (upserts SQLite + Zvec). */
    async applyChunksSnapshot(chunks) {
        this.ensureInitialized();
        let imported = 0;
        this.db.exec("BEGIN");
        try {
            for (const ch of chunks) {
                upsertChunk(this.db, ch);
                const vec = await this.embeddings.embed(ch.text);
                await this.zvec.store({
                    id: ch.id,
                    text: ch.text,
                    vector: vec,
                    importance: 0.5,
                    category: "other",
                });
                imported++;
            }
            this.db.exec("COMMIT");
        }
        catch (err) {
            try {
                this.db.exec("ROLLBACK");
            }
            catch { }
            throw err;
        }
        return { imported };
    }
    async readFile(params) {
        this.ensureInitialized();
        const from = Math.max(1, Math.floor(params.from ?? 1));
        const lines = Math.max(1, Math.floor(params.lines ?? 200));
        const abs = path.join(this.workspaceDir, params.relPath);
        try {
            const raw = await fsp.readFile(abs, "utf8");
            const all = raw.split(/\r?\n/);
            const slice = all.slice(from - 1, from - 1 + lines);
            const nextFrom = from - 1 + lines < all.length ? from + lines : undefined;
            return {
                text: slice.join("\n"),
                path: params.relPath,
                truncated: nextFrom != null,
                from,
                lines: slice.length,
                nextFrom,
            };
        }
        catch (err) {
            const code = err.code;
            if (code !== "ENOENT") {
                throw err;
            }
        }
        const chunks = getIndexedChunksForLineRange(this.db, {
            relPath: params.relPath,
            from,
            lines,
        });
        if (chunks.length === 0) {
            const indexed = listIndexedRelPaths(this.db).includes(params.relPath);
            if (indexed) {
                throw new Error(`memory-zvec: no indexed lines for ${params.relPath} at from=${from} lines=${lines} (file missing on disk)`);
            }
            throw new Error(`memory-zvec: path not found: ${params.relPath}`);
        }
        const text = chunks.map((c) => c.text).join("\n\n");
        const lastEnd = chunks[chunks.length - 1].endLine;
        const nextFrom = lastEnd >= from + lines - 1 ? from + lines : undefined;
        return {
            text,
            path: params.relPath,
            truncated: nextFrom != null,
            from,
            lines: chunks.length,
            nextFrom,
        };
    }
}
//# sourceMappingURL=memory-manager.js.map