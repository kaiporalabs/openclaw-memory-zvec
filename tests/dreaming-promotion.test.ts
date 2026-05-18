import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyDreamingPromotions,
  MEMORY_DREAMS_REL_PATH,
  MEMORY_DREAMS_STM_DIR,
  rankDreamingCandidates,
} from "../src/dreaming/promotion.js";
import type { ChunkRow } from "../src/sqlite-store.js";
import type { ZvecDreamingRuntimeConfig } from "../src/dreaming/config.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

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

describe("applyDreamingPromotions", () => {
  const baseConfig: ZvecDreamingRuntimeConfig = {
    enabled: true,
    cron: "0 3 * * *",
    limit: 5,
    recencyHalfLifeDays: 14,
    minPromotionScore: 0.5,
    minRecallCount: 3,
    minUniqueQueries: 2,
    verboseLogging: false,
    storageMode: "both",
    separateReports: true,
  };

  it("writes DREAMS.md and stages memory/.dreams; promotes only high scores to MEMORY.md", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocmz-dream-"));
    tmpDirs.push(workspaceDir);
    await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Memory\n", "utf8");

    const nowMs = Date.parse("2026-05-17T12:00:00Z");
    const candidates = [
      {
        chunk: {
          id: "high",
          relPath: "memory/2026-05-17.md",
          startLine: 1,
          endLine: 2,
          text: "User prefers PostgreSQL for all new services",
          updatedAtMs: nowMs,
          scope: "global",
        },
        score: 0.9,
      },
      {
        chunk: {
          id: "low",
          relPath: "memory/2026-05-16.md",
          startLine: 1,
          endLine: 2,
          text: "casual chat about weather",
          updatedAtMs: nowMs - 86_400_000,
          scope: "global",
        },
        score: 0.2,
      },
    ];

    const result = await applyDreamingPromotions({
      workspaceDir,
      candidates,
      config: baseConfig,
      nowMs,
    });

    expect(result.applied).toBe(1);
    const dreams = await fs.readFile(path.join(workspaceDir, MEMORY_DREAMS_REL_PATH), "utf8");
    expect(dreams).toContain("PostgreSQL");
    expect(dreams).toContain("weather");

    const memory = await fs.readFile(path.join(workspaceDir, "MEMORY.md"), "utf8");
    expect(memory).toContain("PostgreSQL");
    expect(memory).not.toContain("weather");

    const stmFiles = await fs.readdir(path.join(workspaceDir, MEMORY_DREAMS_STM_DIR));
    expect(stmFiles).toContain("high.json");
    expect(stmFiles).toContain("low.json");
  });
});
