import type { ChunkSnippetRow } from "./sqlite-store.js";

export type FusedCandidate = {
  id: string;
  vectorScore?: number;
  ftsScore?: number;
  bm25Raw?: number;
  fusedScore: number;
};

/** BM25 from SQLite FTS: lower is better → normalize within batch to [0,1] */
export function bm25BatchToScores(rows: Array<{ id: string; bm25: number }>): Map<string, number> {
  const scores = new Map<string, number>();
  if (rows.length === 0) return scores;
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    min = Math.min(min, r.bm25);
    max = Math.max(max, r.bm25);
  }
  const span = max - min || 1;
  for (const r of rows) {
    const norm = (max - r.bm25) / span;
    scores.set(r.id, Math.min(1, Math.max(0, norm)));
  }
  return scores;
}

export function fuseHybridScores(params: {
  ids: Set<string>;
  vectorById: Map<string, number>;
  ftsById: Map<string, number>;
  vectorWeight: number;
  ftsWeight: number;
  mode: "hybrid" | "vector" | "fts";
}): Map<string, number> {
  const out = new Map<string, number>();
  const wv = params.vectorWeight;
  const wf = params.ftsWeight;
  const sum = wv + wf || 1;

  for (const id of params.ids) {
    const v = params.vectorById.get(id);
    const f = params.ftsById.get(id);
    let fused = 0;
    if (params.mode === "vector") {
      fused = v ?? 0;
    } else if (params.mode === "fts") {
      fused = f ?? 0;
    } else {
      const vv = v ?? 0;
      const ff = f ?? 0;
      fused = (wv * vv + wf * ff) / sum;
    }
    out.set(id, fused);
  }
  return out;
}

export function applyTimeDecay(params: {
  fusedScore: number;
  updatedAtMs: number;
  halfLifeDays: number;
  weight: number;
}): number {
  if (params.weight <= 0 || params.halfLifeDays <= 0) return params.fusedScore;
  const ageDays = Math.max(0, (Date.now() - params.updatedAtMs) / 86_400_000);
  const decay = Math.pow(0.5, ageDays / params.halfLifeDays);
  return params.fusedScore * (1 - params.weight + params.weight * decay);
}

export function maximalMarginalRelevance(params: {
  candidates: Array<{ id: string; text: string; score: number }>;
  maxResults: number;
  lambda: number;
}): string[] {
  const pool = [...params.candidates].sort((a, b) => b.score - a.score);
  const selected: string[] = [];
  const remaining = new Set(pool.map((p) => p.id));

  const sim = (a: string, b: string): number => {
    const ta = a.toLowerCase().split(/\s+/).filter(Boolean);
    const tb = b.toLowerCase().split(/\s+/).filter(Boolean);
    if (ta.length === 0 || tb.length === 0) return 0;
    const sa = new Set(ta);
    let inter = 0;
    for (const w of tb) {
      if (sa.has(w)) inter++;
    }
    const union = sa.size + tb.length - inter;
    return union ? inter / union : 0;
  };

  while (selected.length < params.maxResults && remaining.size > 0) {
    let bestId: string | null = null;
    let bestMm = -Infinity;

    for (const c of pool) {
      if (!remaining.has(c.id)) continue;
      const rel = c.score;
      let div = 0;
      if (selected.length > 0) {
        const texts = selected.map((sid) => pool.find((x) => x.id === sid)?.text ?? "");
        div = Math.max(...texts.map((t) => sim(c.text, t)));
      }
      const mmr = params.lambda * rel - (1 - params.lambda) * div;
      if (mmr > bestMm) {
        bestMm = mmr;
        bestId = c.id;
      }
    }
    if (!bestId) break;
    selected.push(bestId);
    remaining.delete(bestId);
  }

  return selected;
}

export type ChunkSnippetWithBm25 = ChunkSnippetRow & { bm25: number };
