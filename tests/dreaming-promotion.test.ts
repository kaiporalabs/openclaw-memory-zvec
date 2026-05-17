import { describe, expect, it } from "vitest";
import { rankDreamingCandidates } from "../src/dreaming/promotion.js";
import type { ChunkRow } from "../src/sqlite-store.js";

describe("rankDreamingCandidates", () => {
  it("prefers recent daily notes and skips dreaming reports", () => {
    const nowMs = Date.parse("2026-05-17T12:00:00Z");
    const chunks: ChunkRow[] = [
      {
        id: "a",
        relPath: "memory/dreaming/report-2026-05-16.md",
        startLine: 1,
        endLine: 3,
        text: "old report",
        updatedAtMs: nowMs - 86_400_000,
        scope: "global",
      },
      {
        id: "b",
        relPath: "memory/2026-05-17.md",
        startLine: 1,
        endLine: 2,
        text: "fresh daily note about deployment preferences",
        updatedAtMs: nowMs - 3_600_000,
        scope: "global",
      },
      {
        id: "c",
        relPath: "memory/2026-05-10.md",
        startLine: 1,
        endLine: 2,
        text: "older daily note content here",
        updatedAtMs: nowMs - 8 * 86_400_000,
        scope: "global",
      },
    ];

    const ranked = rankDreamingCandidates({
      chunks,
      nowMs,
      config: { limit: 2, recencyHalfLifeDays: 14, maxAgeDays: 30 },
    });

    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.chunk.id).toBe("b");
    expect(ranked.every((r) => !r.chunk.relPath.startsWith("memory/dreaming/"))).toBe(true);
  });
});
