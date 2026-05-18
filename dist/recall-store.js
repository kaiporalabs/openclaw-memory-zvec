import { createHash } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { formatMemoryDreamingDay } from "openclaw/plugin-sdk/memory-core-host-status";
import { MEMORY_DREAMS_STM_DIR } from "./dreaming/promotion.js";
const SHORT_TERM_STORE_RELATIVE_PATH = path.join("memory", ".dreams", "short-term-recall.json");
const SHORT_TERM_PATH_RE = /(?:^|\/)memory\/(?:[^/]+\/)*(\d{4})-(\d{2})-(\d{2})(?:-[^/]+)?\.md$/;
const MAX_QUERY_HASHES = 32;
const MAX_RECALL_DAYS = 16;
const DAY_MS = 86_400_000;
function clampScore(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(1, value));
}
function normalizeMemoryPath(raw) {
    const trimmed = raw.trim().replace(/\\/g, "/");
    if (!trimmed) {
        return "";
    }
    return trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
}
function normalizeSnippet(raw) {
    return raw.replace(/\s+/g, " ").trim();
}
export function isShortTermMemoryPath(relPath) {
    const normalized = normalizeMemoryPath(relPath);
    if (!normalized || normalized === "MEMORY.md" || normalized === "DREAMS.md") {
        return false;
    }
    if (normalized.startsWith(`${MEMORY_DREAMS_STM_DIR}/`) || normalized.startsWith("memory/dreaming/")) {
        return false;
    }
    return SHORT_TERM_PATH_RE.test(`/${normalized}`);
}
function hashQuery(query) {
    return createHash("sha256").update(query).digest("hex").slice(0, 16);
}
function buildEntryKey(result) {
    return `${normalizeMemoryPath(result.path)}:${Math.max(1, Math.floor(result.startLine))}:${Math.max(1, Math.floor(result.endLine))}`;
}
function mergeQueryHashes(existing, next) {
    if (existing.includes(next)) {
        return existing;
    }
    return [...existing, next].slice(-MAX_QUERY_HASHES);
}
function mergeRecentDistinct(existing, day, max) {
    if (!day) {
        return existing;
    }
    const without = existing.filter((d) => d !== day);
    return [...without, day].slice(-max);
}
function storePath(workspaceDir) {
    return path.join(workspaceDir, SHORT_TERM_STORE_RELATIVE_PATH);
}
async function readStore(workspaceDir, nowIso) {
    try {
        const raw = await fsp.readFile(storePath(workspaceDir), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1 && parsed.entries && typeof parsed.entries === "object") {
            return parsed;
        }
    }
    catch (err) {
        if (err.code !== "ENOENT") {
            throw err;
        }
    }
    return { version: 1, updatedAt: nowIso, entries: {} };
}
async function writeStore(workspaceDir, store) {
    const dir = path.dirname(storePath(workspaceDir));
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(storePath(workspaceDir), `${JSON.stringify(store, null, 2)}\n`, "utf8");
}
function totalSignalCount(entry) {
    return (Math.max(0, Math.floor(entry.recallCount)) +
        Math.max(0, Math.floor(entry.dailyCount)) +
        Math.max(0, Math.floor(entry.groundedCount)));
}
function calculateRecencyComponent(ageDays, halfLifeDays) {
    const halfLife = Math.max(1, halfLifeDays);
    return Math.pow(0.5, Math.max(0, ageDays) / halfLife);
}
function calculateConsolidationComponent(recallDays) {
    return clampScore(recallDays.length / 5);
}
export async function recordShortTermRecalls(params) {
    const workspaceDir = params.workspaceDir.trim();
    const query = params.query.trim();
    if (!workspaceDir || !query) {
        return;
    }
    const relevant = params.results.filter((result) => result.source === "memory" && isShortTermMemoryPath(result.path));
    if (relevant.length === 0) {
        return;
    }
    const nowMs = Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const queryHash = hashQuery(query);
    const todayBucket = formatMemoryDreamingDay(nowMs, params.timezone);
    const store = await readStore(workspaceDir, nowIso);
    for (const result of relevant) {
        const normalizedPath = normalizeMemoryPath(result.path);
        const snippet = normalizeSnippet(result.snippet ?? "");
        if (!snippet) {
            continue;
        }
        const key = buildEntryKey(result);
        const existing = store.entries[key];
        const recallDaysBase = existing?.recallDays ?? [];
        const queryHashesBase = existing?.queryHashes ?? [];
        const dedupeSignal = Boolean(params.dedupeByQueryPerDay) &&
            queryHashesBase.includes(queryHash) &&
            recallDaysBase.includes(todayBucket);
        const recallCount = Math.max(0, Math.floor(existing?.recallCount ?? 0) + (dedupeSignal ? 0 : 1));
        const score = clampScore(result.score);
        store.entries[key] = {
            key,
            path: normalizedPath,
            startLine: Math.max(1, Math.floor(result.startLine)),
            endLine: Math.max(1, Math.floor(result.endLine)),
            source: "memory",
            snippet: snippet || existing?.snippet || "",
            recallCount,
            dailyCount: Math.max(0, Math.floor(existing?.dailyCount ?? 0)),
            groundedCount: Math.max(0, Math.floor(existing?.groundedCount ?? 0)),
            totalScore: Math.max(0, (existing?.totalScore ?? 0) + (dedupeSignal ? 0 : score)),
            maxScore: Math.max(existing?.maxScore ?? 0, dedupeSignal ? 0 : score),
            firstRecalledAt: existing?.firstRecalledAt ?? nowIso,
            lastRecalledAt: nowIso,
            queryHashes: mergeQueryHashes(queryHashesBase, queryHash),
            recallDays: mergeRecentDistinct(recallDaysBase, todayBucket, MAX_RECALL_DAYS),
            conceptTags: existing?.conceptTags ?? [],
            ...(existing?.promotedAt ? { promotedAt: existing.promotedAt } : {}),
        };
    }
    store.updatedAt = nowIso;
    await writeStore(workspaceDir, store);
}
function matchChunkForEntry(entry, chunks) {
    const direct = chunks.find((chunk) => normalizeMemoryPath(chunk.relPath) === entry.path &&
        chunk.startLine === entry.startLine &&
        chunk.endLine === entry.endLine);
    if (direct) {
        return direct;
    }
    const lastRecalledAtMs = Date.parse(entry.lastRecalledAt);
    return {
        id: entry.key,
        relPath: entry.path,
        startLine: entry.startLine,
        endLine: entry.endLine,
        text: entry.snippet,
        updatedAtMs: Number.isFinite(lastRecalledAtMs) ? lastRecalledAtMs : Date.now(),
        scope: "global",
    };
}
export async function rankRecallPromotionCandidates(params) {
    const workspaceDir = params.workspaceDir.trim();
    if (!workspaceDir) {
        return [];
    }
    const nowMs = Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const store = await readStore(workspaceDir, nowIso);
    const maxAgeDays = typeof params.config.maxAgeDays === "number" ? params.config.maxAgeDays : undefined;
    const candidates = [];
    for (const entry of Object.values(store.entries)) {
        if (!entry || entry.source !== "memory" || !isShortTermMemoryPath(entry.path) || entry.promotedAt) {
            continue;
        }
        const signalCount = totalSignalCount(entry);
        if (signalCount < params.config.minRecallCount) {
            continue;
        }
        const uniqueQueries = entry.queryHashes.length;
        const contextDiversity = Math.max(uniqueQueries, entry.recallDays.length);
        if (contextDiversity < params.config.minUniqueQueries) {
            continue;
        }
        const avgScore = clampScore(entry.totalScore / Math.max(1, signalCount));
        const frequency = clampScore(Math.log1p(signalCount) / Math.log1p(10));
        const diversity = clampScore(contextDiversity / 5);
        const lastRecalledAtMs = Date.parse(entry.lastRecalledAt);
        const ageDays = Number.isFinite(lastRecalledAtMs)
            ? Math.max(0, (nowMs - lastRecalledAtMs) / DAY_MS)
            : 0;
        if (maxAgeDays !== undefined && ageDays > maxAgeDays) {
            continue;
        }
        const recency = clampScore(calculateRecencyComponent(ageDays, params.config.recencyHalfLifeDays));
        const consolidation = calculateConsolidationComponent(entry.recallDays);
        const score = clampScore(0.24 * frequency +
            0.3 * avgScore +
            0.15 * diversity +
            0.15 * recency +
            0.1 * consolidation +
            0.06 * 0);
        if (score < params.config.minScore) {
            continue;
        }
        const chunk = matchChunkForEntry(entry, params.chunks);
        if (!chunk) {
            continue;
        }
        candidates.push({
            chunk,
            score,
            recallCount: entry.recallCount,
            uniqueQueries,
        });
    }
    candidates.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return (b.recallCount ?? 0) - (a.recallCount ?? 0);
    });
    return candidates.slice(0, Math.max(0, params.config.limit));
}
export async function recordManagerRecalls(params) {
    await recordShortTermRecalls({
        workspaceDir: params.workspaceDir,
        query: params.query,
        results: params.results,
        timezone: params.timezone,
        dedupeByQueryPerDay: true,
    });
}
export async function markRecallEntriesPromoted(params) {
    const workspaceDir = params.workspaceDir.trim();
    if (!workspaceDir || params.candidates.length === 0) {
        return;
    }
    const nowMs = Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const store = await readStore(workspaceDir, nowIso);
    let changed = false;
    for (const { chunk } of params.candidates) {
        const key = buildEntryKey({
            path: chunk.relPath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
        });
        const entry = store.entries[key];
        if (!entry || entry.promotedAt) {
            continue;
        }
        store.entries[key] = { ...entry, promotedAt: nowIso };
        changed = true;
    }
    if (changed) {
        store.updatedAt = nowIso;
        await writeStore(workspaceDir, store);
    }
}
//# sourceMappingURL=recall-store.js.map