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
import type { DatabaseSync } from "node:sqlite";
import type {
  MemoryEmbeddingProbeResult,
  MemoryReadResult,
  MemorySearchManager,
  MemorySearchResult,
  MemorySearchRuntimeDebug,
  MemorySource,
  MemoryProviderStatus,
} from "openclaw/plugin-sdk/memory-core-host-engine-storage";
import type { PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
import { describeEmbeddingEndpoint, formatErrorDiagnostic } from "./error-diagnostic.js";
import {
  computeStatusOverallOk,
  probeFilesystemPath,
  type PathProbeResult,
} from "./status-self-test.js";
import type { Embeddings } from "./embeddings.js";
import type { MemoryConfig } from "./config.js";
import { normalizeRecallQuery } from "./prompt-helpers.js";
import { MemoryZvecStore } from "./zvec-store.js";
import {
  computeChunkId,
  deleteChunksForFile,
  fileState,
  getChunkById,
  initMemorySchema,
  openMemorySqlite,
  searchFts,
  stats as sqliteStats,
  upsertChunk,
  upsertFileState,
} from "./sqlite-store.js";

type IndexChunk = {
  id: string;
  relPath: string;
  startLine: number;
  endLine: number;
  text: string;
};

function looksIndexableFile(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".markdown")) return true;
  return relPath === "MEMORY.md" || relPath === "USER.md" || relPath === "IDENTITY.md";
}

async function listMemoryRoots(workspaceDir: string): Promise<string[]> {
  const roots = ["MEMORY.md", "USER.md", "IDENTITY.md", "memory"];
  const out: string[] = [];
  for (const r of roots) {
    const abs = path.join(workspaceDir, r);
    try {
      await fsp.stat(abs);
      out.push(r);
    } catch {
      // ignore
    }
  }
  return out;
}

async function crawlFiles(workspaceDir: string): Promise<string[]> {
  const roots = await listMemoryRoots(workspaceDir);
  const files: string[] = [];

  for (const root of roots) {
    const absRoot = path.join(workspaceDir, root);
    const st = await fsp.stat(absRoot);
    if (st.isFile()) {
      files.push(root);
      continue;
    }
    if (!st.isDirectory()) continue;

    const stack: string[] = [root];
    while (stack.length) {
      const relDir = stack.pop()!;
      const absDir = path.join(workspaceDir, relDir);
      const entries = await fsp.readdir(absDir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.name.startsWith(".")) continue;
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

function chunkTextByLines(params: { relPath: string; text: string; maxChars: number }): IndexChunk[] {
  const lines = params.text.split(/\r?\n/);
  const chunks: IndexChunk[] = [];

  let buf: string[] = [];
  let startLine = 1;
  let bufChars = 0;

  const flush = (endLine: number) => {
    const body = buf.join("\n").trim();
    buf = [];
    bufChars = 0;
    if (!body) return;
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

export type MemoryZvecStatusSelfTest = {
  checkedAtMs: number;
  overallOk: boolean;
  embeddingEndpointSummary: string;
  workspaceDir: PathProbeResult;
  sqlitePath: PathProbeResult;
  zvecDataRoot: PathProbeResult;
  /** Workspace-relative memory corpus roots that exist (e.g. `MEMORY.md`, `memory`). */
  memoryCorpusRootsPresent: string[];
  zvecCollection: { ok: boolean; docCount?: number; error?: string };
  embedding: MemoryEmbeddingProbeResult;
  sqlite: { ok: boolean; files?: number; chunks?: number; error?: string };
  notes: string[];
};

function isProbeableFilesystemPath(p: string): boolean {
  const t = p.trim();
  if (!t) {
    return false;
  }
  if (t.includes("://") && !t.startsWith("file:")) {
    return false;
  }
  return true;
}

function toFilesystemAbsolutePath(p: string): string {
  const t = p.trim();
  if (t.startsWith("file:")) {
    try {
      return fileURLToPath(new URL(t));
    } catch {
      return t;
    }
  }
  return t;
}

export class ZvecSqliteMemoryManager implements MemorySearchManager {
  private db: DatabaseSync;
  private initialized = false;
  private lastEmbedProbe: MemoryEmbeddingProbeResult | null = null;
  private statusSelfTest: MemoryZvecStatusSelfTest | null = null;

  constructor(
    private readonly cfg: MemoryConfig,
    private readonly workspaceDir: string,
    private readonly agentId: string,
    private readonly embeddings: Embeddings,
    private readonly zvec: MemoryZvecStore,
    private readonly pluginLog?: PluginLogger,
  ) {
    this.db = openMemorySqlite({ sqlitePath: cfg.sqlitePath! });
  }

  private ensureInitialized() {
    if (this.initialized) return;
    initMemorySchema(this.db);
    this.initialized = true;
  }

  status(): MemoryProviderStatus {
    this.ensureInitialized();
    const st = sqliteStats(this.db);
    const selfTest = this.statusSelfTest;
    const zvecOk = selfTest?.zvecCollection.ok ?? true;
    const embedOk = selfTest?.embedding.ok ?? true;
    const ftsOk = selfTest?.sqlite.ok ?? true;
    let vectorLoadError: string | undefined;
    if (selfTest) {
      if (!selfTest.embedding.ok && selfTest.embedding.error) {
        vectorLoadError = `embeddings: ${selfTest.embedding.error}`;
      } else if (!selfTest.zvecCollection.ok && selfTest.zvecCollection.error) {
        vectorLoadError = `zvec: ${selfTest.zvecCollection.error}`;
      }
    }
    return {
      backend: "builtin",
      provider: this.cfg.embedding.provider,
      model: this.cfg.embedding.model,
      files: st.files,
      chunks: st.chunks,
      dirty: st.dirty,
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
  async runStatusSelfTest(): Promise<void> {
    const checkedAtMs = Date.now();
    const notes: string[] = [];

    const workspaceDir = await probeFilesystemPath(this.workspaceDir);
    if (!workspaceDir.ok) {
      notes.push("Workspace directory missing or unreadable; memory file index cannot run.");
    }

    const sp = this.cfg.sqlitePath ?? "";
    let sqlitePath: PathProbeResult;
    if (!sp.trim()) {
      sqlitePath = { path: "", ok: false, kind: "missing", error: "sqlitePath is empty" };
    } else if (!isProbeableFilesystemPath(sp)) {
      sqlitePath = { path: sp, ok: true, kind: "unknown" };
      notes.push("SQLite path uses a non-local URI; filesystem probe skipped.");
    } else {
      sqlitePath = await probeFilesystemPath(toFilesystemAbsolutePath(sp));
      if (!sqlitePath.ok) {
        notes.push("SQLite path not found on disk (unexpected after open).");
      }
    }

    const dbp = this.cfg.dbPath ?? "";
    let zvecDataRoot: PathProbeResult;
    let zvecCollection: MemoryZvecStatusSelfTest["zvecCollection"] = { ok: false };

    if (!dbp.trim()) {
      zvecDataRoot = { path: "", ok: false, kind: "missing", error: "dbPath is empty" };
      zvecCollection = { ok: false, error: "dbPath is empty" };
    } else if (!isProbeableFilesystemPath(dbp)) {
      zvecDataRoot = { path: dbp, ok: true, kind: "unknown" };
      notes.push("Zvec data root uses a non-local URI; filesystem probe skipped.");
      try {
        const docCount = await this.zvec.count();
        zvecCollection = { ok: true, docCount };
      } catch (err) {
        zvecCollection = { ok: false, error: formatErrorDiagnostic(err) };
      }
    } else {
      zvecDataRoot = await probeFilesystemPath(toFilesystemAbsolutePath(dbp));
      try {
        const docCount = await this.zvec.count();
        zvecCollection = { ok: true, docCount };
        zvecDataRoot = await probeFilesystemPath(toFilesystemAbsolutePath(dbp));
      } catch (err) {
        zvecCollection = { ok: false, error: formatErrorDiagnostic(err) };
      }
    }

    const memoryCorpusRootsPresent = await listMemoryRoots(this.workspaceDir);
    if (memoryCorpusRootsPresent.length === 0) {
      notes.push(
        "No MEMORY.md, USER.md, IDENTITY.md, or memory/ in the workspace yet (OK if you only use tool-stored memories).",
      );
    }

    let sqliteStatsResult: MemoryZvecStatusSelfTest["sqlite"] = { ok: false };
    try {
      this.ensureInitialized();
      const s = sqliteStats(this.db);
      sqliteStatsResult = { ok: true, files: s.files, chunks: s.chunks };
    } catch (err) {
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

  async probeVectorAvailability(): Promise<boolean> {
    // If Zvec opened, it's available. We keep this best-effort.
    return true;
  }

  getCachedEmbeddingAvailability(): MemoryEmbeddingProbeResult | null {
    return this.lastEmbedProbe;
  }

  async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
    const started = Date.now();
    try {
      await this.embeddings.embed("ping");
      this.lastEmbedProbe = { ok: true, checked: true, checkedAtMs: started };
      return this.lastEmbedProbe;
    } catch (err) {
      const message = formatErrorDiagnostic(err);
      this.lastEmbedProbe = { ok: false, error: message, checked: true, checkedAtMs: started };
      return this.lastEmbedProbe;
    }
  }

  async close(): Promise<void> {
    try {
      this.db.close();
    } catch {}
    await this.zvec.close();
  }

  async sync(params?: { reason?: string; force?: boolean }): Promise<void> {
    void params;
    this.ensureInitialized();

    const files = await crawlFiles(this.workspaceDir);

    this.db.exec("BEGIN");
    try {
      for (const relPath of files) {
        const absPath = path.join(this.workspaceDir, relPath);
        const st = await fsp.stat(absPath);
        const prev = fileState(this.db, relPath);
        if (!params?.force && prev && prev.mtimeMs === st.mtimeMs && prev.sizeBytes === st.size) {
          continue;
        }

        const raw = await fsp.readFile(absPath, "utf8");
        const chunks = chunkTextByLines({ relPath, text: raw, maxChars: 1200 });

        deleteChunksForFile(this.db, relPath);
        for (const chunk of chunks) {
          upsertChunk(this.db, {
            id: chunk.id,
            relPath: chunk.relPath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            text: chunk.text,
            updatedAtMs: Date.now(),
          });
          const vec = await this.embeddings.embed(chunk.text);
          await this.zvec.store({
            id: chunk.id,
            text: chunk.text,
            vector: vec,
            importance: 0.5,
            category: "other",
          });
        }
        upsertFileState(this.db, { relPath, mtimeMs: st.mtimeMs, sizeBytes: st.size });
      }

      this.db.exec("COMMIT");
    } catch (err) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      this.pluginLog?.warn(
        `memory-zvec: sync failed [agent=${this.agentId}]: ${formatErrorDiagnostic(err)}`,
      );
      throw err;
    }
  }

  async search(
    query: string,
    opts?: {
      maxResults?: number;
      minScore?: number;
      sessionKey?: string;
      qmdSearchModeOverride?: "query" | "search" | "vsearch";
      onDebug?: (debug: MemorySearchRuntimeDebug) => void;
      sources?: MemorySource[];
    },
  ): Promise<MemorySearchResult[]> {
    void opts?.qmdSearchModeOverride;
    this.ensureInitialized();

    const maxResults = Math.max(1, Math.floor(opts?.maxResults ?? 8));
    const minScore = typeof opts?.minScore === "number" ? opts.minScore : 0.2;

    // 1) Vector search candidates.
    let vectorResults: Array<{ id: string; score: number }> = [];
    try {
      const qVec = await this.embeddings.embed(normalizeRecallQuery(query, this.cfg.recallMaxChars));
      const z = await this.zvec.search(qVec, maxResults * 3, 0);
      vectorResults = z.map((r) => ({ id: r.entry.id, score: r.score }));
    } catch (err) {
      this.pluginLog?.warn(
        `memory-zvec: vector search leg failed (using FTS only) [agent=${this.agentId}]: ${formatErrorDiagnostic(err)}`,
      );
    }

    // 2) FTS candidates.
    const fts = searchFts(this.db, { query, limit: maxResults * 3 });

    // Merge by id.
    const merged = new Map<string, { vectorScore?: number; textScore?: number; relPath?: string; startLine?: number; endLine?: number; snippet?: string }>();
    for (const v of vectorResults) {
      merged.set(v.id, { ...(merged.get(v.id) ?? {}), vectorScore: v.score });
    }
    for (const r of fts) {
      merged.set(r.id, {
        ...(merged.get(r.id) ?? {}),
        relPath: r.relPath,
        startLine: r.startLine,
        endLine: r.endLine,
        snippet: r.snippet,
        textScore: 0.35,
      });
    }

    const scored: MemorySearchResult[] = [];
    for (const [id, info] of merged) {
      const chunk = getChunkById(this.db, id);
      if (!chunk) continue;
      const score = Math.max(info.vectorScore ?? 0, info.textScore ?? 0);
      if (score < minScore) continue;
      scored.push({
        path: chunk.relPath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        score,
        vectorScore: info.vectorScore,
        textScore: info.textScore,
        snippet: info.snippet ?? chunk.text.slice(0, 220),
        source: "memory",
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults);
  }

  async readFile(params: { relPath: string; from?: number; lines?: number }): Promise<MemoryReadResult> {
    const abs = path.join(this.workspaceDir, params.relPath);
    const raw = await fsp.readFile(abs, "utf8");
    const all = raw.split(/\r?\n/);
    const from = Math.max(1, Math.floor(params.from ?? 1));
    const lines = Math.max(1, Math.floor(params.lines ?? 200));
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
}

