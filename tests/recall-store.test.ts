import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ChunkRow } from "../src/sqlite-store.js";
import {
  isShortTermMemoryPath,
  rankRecallPromotionCandidates,
  recordShortTermRecalls,
} from "../src/recall-store.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("isShortTermMemoryPath", () => {
  it("accepts dated session notes and rejects internal dreaming paths", () => {
    expect(isShortTermMemoryPath("memory/2026-05-10-1134.md")).toBe(true);
    expect(isShortTermMemoryPath("MEMORY.md")).toBe(false);
    expect(isShortTermMemoryPath("memory/.dreams/foo.json")).toBe(false);
    expect(isShortTermMemoryPath("memory/dreaming/report.md")).toBe(false);
  });
});

describe("recall store", () => {
  it("records recalls and ranks candidates by frequency gates", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocmz-recall-"));
    tmpDirs.push(workspaceDir);

    const relPath = "memory/2026-05-10-1134.md";
    const snippet = "User installed clawhub successfully with npm on the server";
    const chunks: ChunkRow[] = [
      {
        id: "chunk-1",
        relPath,
        startLine: 1,
        endLine: 3,
        text: snippet,
        updatedAtMs: Date.now(),
        scope: "global",
      },
    ];

    for (let i = 0; i < 3; i++) {
      await recordShortTermRecalls({
        workspaceDir,
        query: `clawhub install query ${i}`,
        results: [
          {
            path: relPath,
            startLine: 1,
            endLine: 3,
            score: 0.85,
            snippet,
            source: "memory",
          },
        ],
        dedupeByQueryPerDay: false,
      });
    }

    const ranked = await rankRecallPromotionCandidates({
      workspaceDir,
      chunks,
      config: {
        limit: 5,
        minScore: 0.5,
        minRecallCount: 3,
        minUniqueQueries: 3,
        recencyHalfLifeDays: 14,
      },
    });

    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.recallCount).toBe(3);
    expect(ranked[0]!.uniqueQueries).toBe(3);
    expect(ranked[0]!.chunk.relPath).toBe(relPath);

    const storePath = path.join(workspaceDir, "memory", ".dreams", "short-term-recall.json");
    const storeRaw = await fs.readFile(storePath, "utf8");
    expect(storeRaw).toContain("clawhub");
  });
});
