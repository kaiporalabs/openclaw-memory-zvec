import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  type ZVecDoc,
  ZVecCollection,
  ZVecCollectionSchema,
  ZVecCreateAndOpen,
  ZVecDataType,
  ZVecIndexType,
  ZVecInitialize,
  ZVecLogLevel,
  ZVecMetricType,
  ZVecOpen,
} from "@zvec/zvec";
import type { MemoryCategory } from "./config.js";
import { validateWritableDirectory } from "./path-validation.js";

let zvecGlobalInit = false;

function ensureZvecInit(): void {
  if (zvecGlobalInit) {
    return;
  }
  ZVecInitialize({ logLevel: ZVecLogLevel.WARN });
  zvecGlobalInit = true;
}

export type MemoryEntry = {
  id: string;
  text: string;
  vector: number[];
  importance: number;
  category: MemoryCategory;
  createdAt: number;
};

export type MemoryListEntry = Omit<MemoryEntry, "vector">;

export type MemorySearchResult = {
  entry: MemoryEntry;
  score: number;
};

const COLLECTION_DIR = "collection";
const IDS_FILE = "memory-ids.json";

function readIds(idsPath: string): string[] {
  try {
    const raw = fs.readFileSync(idsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

function writeIds(idsPath: string, ids: string[]): void {
  fs.mkdirSync(path.dirname(idsPath), { recursive: true });
  fs.writeFileSync(idsPath, `${JSON.stringify(ids, null, 0)}\n`, "utf8");
}

function buildSchema(vectorDim: number): ZVecCollectionSchema {
  return new ZVecCollectionSchema({
    name: "openclaw_memories",
    vectors: {
      name: "embedding",
      dataType: ZVecDataType.VECTOR_FP32,
      dimension: vectorDim,
      indexParams: {
        indexType: ZVecIndexType.HNSW,
        metricType: ZVecMetricType.COSINE,
        m: 32,
        efConstruction: 200,
      },
    },
    fields: [
      { name: "text", dataType: ZVecDataType.STRING },
      { name: "category", dataType: ZVecDataType.STRING },
      { name: "importance", dataType: ZVecDataType.DOUBLE },
      { name: "createdAt", dataType: ZVecDataType.INT64 },
    ],
  });
}

function moveAsideExistingPath(p: string): string | null {
  if (!fs.existsSync(p)) {
    return null;
  }
  const ts = new Date().toISOString().replaceAll(":", "-");
  const backup = `${p}.backup-${ts}`;
  fs.renameSync(p, backup);
  return backup;
}

export class MemoryZvecStore {
  private collection: ZVecCollection | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(
    private readonly dataRoot: string,
    private readonly vectorDim: number,
  ) {}

  private get collectionPath(): string {
    return path.join(this.dataRoot, COLLECTION_DIR);
  }

  private get idsPath(): string {
    return path.join(this.dataRoot, IDS_FILE);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.collection) {
      return;
    }
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.doInitialize().catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    ensureZvecInit();
    fs.mkdirSync(this.dataRoot, { recursive: true });
    const probe = validateWritableDirectory(this.dataRoot);
    if (!probe.ok) {
      throw new Error(
        `Zvec data root not usable: ${probe.error}` + (probe.hint ? ` (${probe.hint})` : ""),
      );
    }

    const schema = buildSchema(this.vectorDim);
    let coll: ZVecCollection;
    try {
      coll = ZVecOpen(this.collectionPath);
    } catch {
      // If the path exists but isn't a valid Zvec collection, creation will fail with
      // "path validate failed ... exists". Move it aside to avoid a hard-brick.
      moveAsideExistingPath(this.collectionPath);
      coll = ZVecCreateAndOpen(this.collectionPath, schema, {});
    }

    const vec = coll.schema.vector("embedding");
    const dim = vec.dimension ?? 0;
    if (dim !== this.vectorDim) {
      coll.closeSync();
      throw new Error(
        `Zvec collection dimension mismatch: store expects ${this.vectorDim}, on-disk schema has ${dim}. ` +
          `Move away ${this.collectionPath} or align embedding.dimensions/model.`,
      );
    }

    this.collection = coll;
  }

  private loadIdList(): string[] {
    return readIds(this.idsPath);
  }

  private persistIdList(ids: string[]): void {
    writeIds(this.idsPath, ids);
  }

  private rememberId(id: string): void {
    const ids = this.loadIdList();
    if (!ids.includes(id)) {
      ids.push(id);
      this.persistIdList(ids);
    }
  }

  private forgetId(id: string): void {
    const ids = this.loadIdList().filter((x) => x !== id);
    this.persistIdList(ids);
  }

  async store(entry: Omit<MemoryEntry, "id" | "createdAt"> & { id?: string }): Promise<MemoryEntry> {
    await this.ensureInitialized();
    const coll = this.collection!;

    const id = entry.id ?? randomUUID();
    const createdAt = Date.now();
    const full: MemoryEntry = {
      id,
      text: entry.text,
      vector: entry.vector,
      importance: entry.importance,
      category: entry.category,
      createdAt,
    };

    coll.upsertSync({
      id,
      vectors: { embedding: Float32Array.from(full.vector) },
      fields: {
        text: full.text,
        category: full.category,
        importance: full.importance,
        createdAt: full.createdAt,
      },
    });

    this.rememberId(id);
    return full;
  }

  async search(vector: number[], limit: number, minScore: number): Promise<MemorySearchResult[]> {
    await this.ensureInitialized();
    const coll = this.collection!;

    const docs = coll.querySync({
      fieldName: "embedding",
      vector: Float32Array.from(vector),
      topk: Math.max(1, limit),
      includeVector: true,
      outputFields: ["text", "importance", "category", "createdAt"],
    });

    const mapped: MemorySearchResult[] = docs.map((row) => {
      const rawVec = row.vectors.embedding;
      const vec =
        rawVec instanceof Float32Array
          ? [...rawVec]
          : Array.isArray(rawVec)
            ? rawVec.map((x) => Number(x))
            : [];

      const fields = row.fields as Record<string, unknown>;
      const text = String(fields.text ?? "");
      const category = String(fields.category ?? "other") as MemoryEntry["category"];
      const importance = Number(fields.importance ?? 0);
      const createdAt = Number(fields.createdAt ?? 0);

      const score = normalizeCosineScore(row.score);
      return {
        score,
        entry: {
          id: row.id,
          text,
          vector: vec,
          importance,
          category,
          createdAt,
        },
      };
    });

    return mapped.filter((r) => r.score >= minScore);
  }

  async list(limit?: number, orderByCreatedAt = false): Promise<MemoryListEntry[]> {
    await this.ensureInitialized();
    const coll = this.collection!;
    const ids = this.loadIdList();
    if (ids.length === 0) {
      return [];
    }

    const unique = [...new Set(ids)];
    const fetched = coll.fetchSync(unique) as Record<string, ZVecDoc>;

    const entries: MemoryListEntry[] = [];
    for (const id of unique) {
      const doc = fetched[id];
      if (!doc?.fields) {
        continue;
      }
      const f = doc.fields as Record<string, unknown>;
      entries.push({
        id,
        text: String(f.text ?? ""),
        category: String(f.category ?? "other") as MemoryListEntry["category"],
        importance: Number(f.importance ?? 0),
        createdAt: Number(f.createdAt ?? 0),
      });
    }

    if (orderByCreatedAt) {
      entries.sort((a, b) => b.createdAt - a.createdAt);
    }

    if (limit !== undefined) {
      return entries.slice(0, limit);
    }
    return entries;
  }

  async delete(id: string): Promise<boolean> {
    await this.ensureInitialized();
    const coll = this.collection!;
    coll.deleteSync(id);
    this.forgetId(id);
    return true;
  }

  async count(): Promise<number> {
    await this.ensureInitialized();
    return this.collection!.stats.docCount;
  }

  /** Ids tracked in memory-ids.json (may differ from collection docCount until reconcile). */
  listKnownIds(): string[] {
    return [...new Set(this.loadIdList())];
  }

  async close(): Promise<void> {
    if (this.collection) {
      try {
        this.collection.closeSync();
      } catch {
        // ignore
      }
      this.collection = null;
    }
    this.initPromise = null;
  }
}

/** Map engine score to [0,1] similarity for thresholds (COSINE: higher = closer). */
function normalizeCosineScore(raw: number): number {
  if (!Number.isFinite(raw)) {
    return 0;
  }
  if (raw >= 0 && raw <= 1) {
    return raw;
  }
  if (raw >= -1 && raw <= 1) {
    return (raw + 1) / 2;
  }
  return Math.min(1, Math.max(0, raw));
}
