import fsp from "node:fs/promises";
import path from "node:path";
import { formatMemoryDreamingDay } from "openclaw/plugin-sdk/memory-core-host-status";
import type { ChunkRow } from "../sqlite-store.js";
import type { ZvecDreamingRuntimeConfig } from "./config.js";

export type DreamingPromotionCandidate = {
  chunk: ChunkRow;
  score: number;
};

export function scoreChunkRecency(params: {
  updatedAtMs: number;
  nowMs: number;
  halfLifeDays: number;
}): number {
  const ageMs = Math.max(0, params.nowMs - params.updatedAtMs);
  const halfLifeMs = Math.max(1, params.halfLifeDays) * 86_400_000;
  return Math.pow(0.5, ageMs / halfLifeMs);
}

export function rankDreamingCandidates(params: {
  chunks: ChunkRow[];
  nowMs: number;
  config: Pick<ZvecDreamingRuntimeConfig, "maxAgeDays" | "recencyHalfLifeDays" | "limit">;
}): DreamingPromotionCandidate[] {
  const maxAgeMs =
    typeof params.config.maxAgeDays === "number"
      ? params.config.maxAgeDays * 86_400_000
      : undefined;

  const scored: DreamingPromotionCandidate[] = [];
  for (const chunk of params.chunks) {
    if (!chunk.relPath.startsWith("memory/") || chunk.relPath.startsWith("memory/dreaming/")) {
      continue;
    }
    if (maxAgeMs !== undefined && params.nowMs - chunk.updatedAtMs > maxAgeMs) {
      continue;
    }
    const body = chunk.text.trim();
    if (body.length < 12) {
      continue;
    }
    scored.push({
      chunk,
      score: scoreChunkRecency({
        updatedAtMs: chunk.updatedAtMs,
        nowMs: params.nowMs,
        halfLifeDays: params.config.recencyHalfLifeDays,
      }),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, params.config.limit));
}

export async function applyDreamingPromotions(params: {
  workspaceDir: string;
  candidates: DreamingPromotionCandidate[];
  config: ZvecDreamingRuntimeConfig;
  nowMs: number;
}): Promise<{ applied: number; reportLines: string[] }> {
  const reportLines: string[] = [];
  if (params.candidates.length === 0) {
    reportLines.push("- No candidates ranked for promotion.");
    return { applied: 0, reportLines };
  }

  const memoryMdPath = path.join(params.workspaceDir, "MEMORY.md");
  let memoryBody = "";
  try {
    memoryBody = await fsp.readFile(memoryMdPath, "utf8");
  } catch {
    // MEMORY.md may not exist yet
  }

  const promoted: string[] = [];
  let applied = 0;
  for (const { chunk, score } of params.candidates) {
    const line = `- [dreaming] ${chunk.relPath}:${chunk.startLine}-${chunk.endLine} (score=${score.toFixed(3)}) ${chunk.text.trim().replace(/\s+/g, " ").slice(0, 400)}`;
    const fingerprint = chunk.text.trim().toLowerCase().slice(0, 120);
    if (fingerprint.length > 0 && memoryBody.toLowerCase().includes(fingerprint)) {
      continue;
    }
    promoted.push(line);
    applied++;
  }

  if (promoted.length > 0) {
    const header = `\n\n## Dreaming promotion (${formatMemoryDreamingDay(params.nowMs, params.config.timezone)})\n`;
    const block = `${memoryBody.length > 0 && !memoryBody.endsWith("\n") ? "\n" : ""}${header}${promoted.join("\n")}\n`;
    await fsp.writeFile(memoryMdPath, memoryBody + block, "utf8");
    reportLines.push(`- Promoted ${applied} excerpt(s) into MEMORY.md.`);
  } else {
    reportLines.push("- Candidates found but all were already present in MEMORY.md.");
  }

  const day = formatMemoryDreamingDay(params.nowMs, params.config.timezone);
  if (params.config.storageMode === "separate" || params.config.storageMode === "both") {
    const dreamingDir = path.join(params.workspaceDir, "memory", "dreaming");
    await fsp.mkdir(dreamingDir, { recursive: true });
    const reportPath = path.join(dreamingDir, `report-${day}.md`);
    const reportBody = [
      `# Dreaming report ${day}`,
      "",
      `Plugin: memory-zvec`,
      "",
      ...reportLines,
      "",
      "## Candidates",
      "",
      ...params.candidates.map(
        (c) =>
          `- ${c.chunk.relPath}:${c.chunk.startLine}-${c.chunk.endLine} score=${c.score.toFixed(3)}\n  ${c.chunk.text.trim().slice(0, 200)}`,
      ),
      "",
    ].join("\n");
    await fsp.writeFile(reportPath, reportBody, "utf8");
    reportLines.push(`- Wrote ${path.relative(params.workspaceDir, reportPath)}.`);
  }

  return { applied, reportLines };
}
