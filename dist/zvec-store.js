import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ZVecCollection, ZVecCollectionSchema, ZVecCreateAndOpen, ZVecDataType, ZVecIndexType, ZVecInitialize, ZVecLogLevel, ZVecMetricType, ZVecOpen, } from "@zvec/zvec";
import { validateWritableDirectory } from "./path-validation.js";
let zvecGlobalInit = false;
function ensureZvecInit() {
    if (zvecGlobalInit) {
        return;
    }
    ZVecInitialize({ logLevel: ZVecLogLevel.WARN });
    zvecGlobalInit = true;
}
const COLLECTION_DIR = "collection";
const IDS_FILE = "memory-ids.json";
function readIds(idsPath) {
    try {
        const raw = fs.readFileSync(idsPath, "utf8");
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter((id) => typeof id === "string");
    }
    catch {
        return [];
    }
}
function writeIds(idsPath, ids) {
    fs.mkdirSync(path.dirname(idsPath), { recursive: true });
    fs.writeFileSync(idsPath, `${JSON.stringify(ids, null, 0)}\n`, "utf8");
}
function buildSchema(vectorDim) {
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
function moveAsideExistingPath(p) {
    if (!fs.existsSync(p)) {
        return null;
    }
    const ts = new Date().toISOString().replaceAll(":", "-");
    const backup = `${p}.backup-${ts}`;
    fs.renameSync(p, backup);
    return backup;
}
export class MemoryZvecStore {
    dataRoot;
    vectorDim;
    collection = null;
    initPromise = null;
    constructor(dataRoot, vectorDim) {
        this.dataRoot = dataRoot;
        this.vectorDim = vectorDim;
    }
    get collectionPath() {
        return path.join(this.dataRoot, COLLECTION_DIR);
    }
    get idsPath() {
        return path.join(this.dataRoot, IDS_FILE);
    }
    async ensureInitialized() {
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
    async doInitialize() {
        ensureZvecInit();
        fs.mkdirSync(this.dataRoot, { recursive: true });
        const probe = validateWritableDirectory(this.dataRoot);
        if (!probe.ok) {
            throw new Error(`Zvec data root not usable: ${probe.error}` + (probe.hint ? ` (${probe.hint})` : ""));
        }
        const schema = buildSchema(this.vectorDim);
        let coll;
        try {
            coll = ZVecOpen(this.collectionPath);
        }
        catch {
            // If the path exists but isn't a valid Zvec collection, creation will fail with
            // "path validate failed ... exists". Move it aside to avoid a hard-brick.
            moveAsideExistingPath(this.collectionPath);
            coll = ZVecCreateAndOpen(this.collectionPath, schema, {});
        }
        const vec = coll.schema.vector("embedding");
        const dim = vec.dimension ?? 0;
        if (dim !== this.vectorDim) {
            coll.closeSync();
            throw new Error(`Zvec collection dimension mismatch: store expects ${this.vectorDim}, on-disk schema has ${dim}. ` +
                `Move away ${this.collectionPath} or align embedding.dimensions/model.`);
        }
        this.collection = coll;
    }
    loadIdList() {
        return readIds(this.idsPath);
    }
    persistIdList(ids) {
        writeIds(this.idsPath, ids);
    }
    rememberId(id) {
        const ids = this.loadIdList();
        if (!ids.includes(id)) {
            ids.push(id);
            this.persistIdList(ids);
        }
    }
    forgetId(id) {
        const ids = this.loadIdList().filter((x) => x !== id);
        this.persistIdList(ids);
    }
    async store(entry) {
        await this.ensureInitialized();
        const coll = this.collection;
        const id = entry.id ?? randomUUID();
        const createdAt = Date.now();
        const full = {
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
    async search(vector, limit, minScore) {
        await this.ensureInitialized();
        const coll = this.collection;
        const docs = coll.querySync({
            fieldName: "embedding",
            vector: Float32Array.from(vector),
            topk: Math.max(1, limit),
            includeVector: true,
            outputFields: ["text", "importance", "category", "createdAt"],
        });
        const mapped = docs.map((row) => {
            const rawVec = row.vectors.embedding;
            const vec = rawVec instanceof Float32Array
                ? [...rawVec]
                : Array.isArray(rawVec)
                    ? rawVec.map((x) => Number(x))
                    : [];
            const fields = row.fields;
            const text = String(fields.text ?? "");
            const category = String(fields.category ?? "other");
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
    async list(limit, orderByCreatedAt = false) {
        await this.ensureInitialized();
        const coll = this.collection;
        const ids = this.loadIdList();
        if (ids.length === 0) {
            return [];
        }
        const unique = [...new Set(ids)];
        const fetched = coll.fetchSync(unique);
        const entries = [];
        for (const id of unique) {
            const doc = fetched[id];
            if (!doc?.fields) {
                continue;
            }
            const f = doc.fields;
            entries.push({
                id,
                text: String(f.text ?? ""),
                category: String(f.category ?? "other"),
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
    async delete(id) {
        await this.ensureInitialized();
        const coll = this.collection;
        coll.deleteSync(id);
        this.forgetId(id);
        return true;
    }
    async count() {
        await this.ensureInitialized();
        return this.collection.stats.docCount;
    }
    /** Ids tracked in memory-ids.json (may differ from collection docCount until reconcile). */
    listKnownIds() {
        return [...new Set(this.loadIdList())];
    }
    async close() {
        if (this.collection) {
            try {
                this.collection.closeSync();
            }
            catch {
                // ignore
            }
            this.collection = null;
        }
        this.initPromise = null;
    }
}
/** Map engine score to [0,1] similarity for thresholds (COSINE: higher = closer). */
function normalizeCosineScore(raw) {
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
//# sourceMappingURL=zvec-store.js.map