import fsp from "node:fs/promises";
import path from "node:path";
import { formatMemoryDreamingDay } from "openclaw/plugin-sdk/memory-core-host-status";
import type { ChunkRow } from "../sqlite-store.js";
import type { ZvecDreamingRuntimeConfig } from "./config.js";

export const MEMORY_DREAMS_REL_PATH = "DREAMS.md";
export const MEMORY_DREAMS_STM_DIR = "memory/.dreams";

export type DreamingPromotionCandidate = {
  chunk: ChunkRow;
  score: number;
  recallCount?: number;
  uniqueQueries?: number;
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

function isDreamingInternalPath(relPath: string): boolean {
  return (
    relPath.startsWith("memory/dreaming/") ||
    relPath.startsWith(`${MEMORY_DREAMS_STM_DIR}/`) ||
    relPath === MEMORY_DREAMS_REL_PATH
  );
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
    if (!chunk.relPath.startsWith("memory/") || isDreamingInternalPath(chunk.relPath)) {
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

function formatCandidateLine(candidate: DreamingPromotionCandidate): string {
  const { chunk, score, recallCount, uniqueQueries } = candidate;
  const recallMeta =
    typeof recallCount === "number"
      ? ` recalls=${recallCount}${typeof uniqueQueries === "number" ? ` queries=${uniqueQueries}` : ""}`
      : "";
  return `- [dreaming] ${chunk.relPath}:${chunk.startLine}-${chunk.endLine} (score=${score.toFixed(3)}${recallMeta}) ${chunk.text.trim().replace(/\s+/g, " ").slice(0, 400)}`;
}

async function appendDreamsDiary(params: {
  workspaceDir: string;
  day: string;
  lines: string[];
}): Promise<void> {
  if (params.lines.length === 0) {
    return;
  }
  const dreamsPath = path.join(params.workspaceDir, MEMORY_DREAMS_REL_PATH);
  let body = "";
  try {
    body = await fsp.readFile(dreamsPath, "utf8");
  } catch {
    body = "# Dreams\n\n";
  }
  const header = `\n\n## Dream sweep ${params.day}\n`;
  const block = `${body.length > 0 && !body.endsWith("\n") ? "\n" : ""}${header}${params.lines.join("\n")}\n`;
  await fsp.writeFile(dreamsPath, body + block, "utf8");
}

async function stageShortTermDreams(params: {
  workspaceDir: string;
  candidates: DreamingPromotionCandidate[];
  nowMs: number;
}): Promise<number> {
  const stmDir = path.join(params.workspaceDir, MEMORY_DREAMS_STM_DIR);
  await fsp.mkdir(stmDir, { recursive: true });
  let staged = 0;
  for (const { chunk, score } of params.candidates) {
    const filePath = path.join(stmDir, `${chunk.id}.json`);
    await fsp.writeFile(
      filePath,
      `${JSON.stringify(
        {
          id: chunk.id,
          relPath: chunk.relPath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score,
          text: chunk.text,
          stagedAtMs: params.nowMs,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    staged++;
  }
  return staged;
}

export async function applyDreamingPromotions(params: {
  workspaceDir: string;
  candidates: DreamingPromotionCandidate[];
  config: ZvecDreamingRuntimeConfig;
  nowMs: number;
}): Promise<{ applied: number; promotedCandidates: DreamingPromotionCandidate[]; reportLines: string[] }> {
  const reportLines: string[] = [];
  if (params.candidates.length === 0) {
    reportLines.push("- No candidates ranked for promotion.");
    return { applied: 0, promotedCandidates: [], reportLines };
  }

  const day = formatMemoryDreamingDay(params.nowMs, params.config.timezone);
  const diaryLines = params.candidates.map((candidate) => formatCandidateLine(candidate));

  if (params.config.storageMode === "inline" || params.config.storageMode === "both") {
    await appendDreamsDiary({
      workspaceDir: params.workspaceDir,
      day,
      lines: diaryLines,
    });
    reportLines.push(`- Wrote dream sweep diary to ${MEMORY_DREAMS_REL_PATH}.`);
  }

  const staged = await stageShortTermDreams({
    workspaceDir: params.workspaceDir,
    candidates: params.candidates,
    nowMs: params.nowMs,
  });
  reportLines.push(`- Staged ${staged} candidate(s) under ${MEMORY_DREAMS_STM_DIR}/.`);

  const memoryMdPath = path.join(params.workspaceDir, "MEMORY.md");
  let memoryBody = "";
  try {
    memoryBody = await fsp.readFile(memoryMdPath, "utf8");
  } catch {
    // MEMORY.md may not exist yet
  }

  const promoted: string[] = [];
  const promotedCandidates: DreamingPromotionCandidate[] = [];
  let applied = 0;
  for (const candidate of params.candidates) {
    const { chunk, score } = candidate;
    if (score < params.config.minPromotionScore) {
      continue;
    }
    const line = formatCandidateLine(candidate);
    const fingerprint = chunk.text.trim().toLowerCase().slice(0, 120);
    if (fingerprint.length > 0 && memoryBody.toLowerCase().includes(fingerprint)) {
      continue;
    }
    promoted.push(line);
    promotedCandidates.push(candidate);
    applied++;
  }

  if (promoted.length > 0) {
    const header = `\n\n## Dreaming promotion (${day})\n`;
    const block = `${memoryBody.length > 0 && !memoryBody.endsWith("\n") ? "\n" : ""}${header}${promoted.join("\n")}\n`;
    await fsp.writeFile(memoryMdPath, memoryBody + block, "utf8");
    reportLines.push(
      `- Promoted ${applied} excerpt(s) into MEMORY.md (score >= ${params.config.minPromotionScore.toFixed(3)}).`,
    );
  } else {
    reportLines.push(
      `- No MEMORY.md promotion (none met score >= ${params.config.minPromotionScore.toFixed(3)} or all duplicates).`,
    );
  }

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

  return { applied, promotedCandidates, reportLines };
}
