import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { formatMemoryDreamingDay } from "openclaw/plugin-sdk/memory-core-host-status";
import { MEMORY_DREAMS_REL_PATH, MEMORY_DREAMS_STM_DIR } from "./dreaming/promotion.js";
import { computeChunkId } from "./sqlite-store.js";

const BACKFILL_SOURCE = "rem-backfill";

type BackfillChunk = {
  id: string;
  relPath: string;
  startLine: number;
  endLine: number;
  text: string;
};

function chunkMarkdownByLines(params: {
  relPath: string;
  text: string;
  maxChars: number;
}): BackfillChunk[] {
  const lines = params.text.split(/\r?\n/);
  const chunks: BackfillChunk[] = [];
  let buf: string[] = [];
  let startLine = 1;
  let bufChars = 0;

  const flush = (endLine: number) => {
    const body = buf.join("\n").trim();
    buf = [];
    bufChars = 0;
    if (!body) {
      return;
    }
    const id = computeChunkId({
      relPath: params.relPath,
      startLine,
      endLine,
      text: body,
    });
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

async function listMarkdownFiles(rootDir: string, relPrefix: string): Promise<string[]> {
  const absRoot = path.join(rootDir, relPrefix);
  const st = await fsp.stat(absRoot);
  if (st.isFile()) {
    return [relPrefix.replace(/\\/g, "/")];
  }

  const files: string[] = [];
  const stack = [relPrefix.replace(/\\/g, "/")];
  while (stack.length) {
    const relDir = stack.pop()!;
    const absDir = path.join(rootDir, relDir);
    const entries = await fsp.readdir(absDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith(".")) {
        continue;
      }
      const rel = path.join(relDir, ent.name).replace(/\\/g, "/");
      if (ent.isDirectory()) {
        if (rel.startsWith("memory/.dreams") || rel.startsWith("memory/dreaming")) {
          continue;
        }
        stack.push(rel);
        continue;
      }
      if (ent.isFile() && /\.(md|markdown|txt)$/i.test(ent.name)) {
        files.push(rel);
      }
    }
  }
  files.sort();
  return files;
}

async function readStagedBackfillIds(stmDir: string): Promise<string[]> {
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(stmDir);
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) {
      continue;
    }
    try {
      const raw = await fsp.readFile(path.join(stmDir, name), "utf8");
      const parsed = JSON.parse(raw) as { source?: string; id?: string };
      if (parsed.source === BACKFILL_SOURCE && typeof parsed.id === "string") {
        ids.push(parsed.id);
      }
    } catch {
      // ignore corrupt staging files
    }
  }
  return ids;
}

export type RemBackfillResult = {
  ok: boolean;
  staged: number;
  filesScanned: number;
  rolledBack: number;
  message: string;
};

export async function runRemBackfill(params: {
  workspaceDir: string;
  memoryPath?: string;
  stageShortTerm?: boolean;
  rollback?: boolean;
  rollbackShortTerm?: boolean;
  nowMs?: number;
  timezone?: string;
}): Promise<RemBackfillResult> {
  const nowMs = params.nowMs ?? Date.now();
  const stmDir = path.join(params.workspaceDir, MEMORY_DREAMS_STM_DIR);

  if (params.rollback || params.rollbackShortTerm) {
    let rolledBack = 0;
    try {
      const entries = await fsp.readdir(stmDir);
      for (const name of entries) {
        if (!name.endsWith(".json")) {
          continue;
        }
        const full = path.join(stmDir, name);
        try {
          const raw = await fsp.readFile(full, "utf8");
          const parsed = JSON.parse(raw) as { source?: string };
          if (parsed.source !== BACKFILL_SOURCE) {
            continue;
          }
          await fsp.unlink(full);
          rolledBack++;
        } catch {
          // ignore
        }
      }
    } catch {
      // no stm dir
    }

    if (params.rollback) {
      const dreamsPath = path.join(params.workspaceDir, MEMORY_DREAMS_REL_PATH);
      try {
        let body = await fsp.readFile(dreamsPath, "utf8");
        body = body.replace(/\n+## Grounded backfill[\s\S]*?(?=\n## |\n# |$)/g, "\n");
        await fsp.writeFile(dreamsPath, body.trimEnd() + "\n", "utf8");
      } catch {
        // no dreams file
      }
    }

    return {
      ok: true,
      staged: 0,
      filesScanned: 0,
      rolledBack,
      message: `Rolled back ${rolledBack} staged rem-backfill artifact(s).`,
    };
  }

  const relPrefix = (params.memoryPath ?? "memory").replace(/^\/+/, "").replace(/\\/g, "/");
  const files = await listMarkdownFiles(params.workspaceDir, relPrefix);
  const allChunks: BackfillChunk[] = [];

  for (const relPath of files) {
    const abs = path.join(params.workspaceDir, relPath);
    const raw = await fsp.readFile(abs, "utf8");
    allChunks.push(...chunkMarkdownByLines({ relPath, text: raw, maxChars: 1200 }));
  }

  if (allChunks.length === 0) {
    return {
      ok: true,
      staged: 0,
      filesScanned: files.length,
      rolledBack: 0,
      message: "No backfill candidates found in the given path.",
    };
  }

  let staged = 0;
  if (params.stageShortTerm !== false) {
    await fsp.mkdir(stmDir, { recursive: true });
    const existing = new Set(await readStagedBackfillIds(stmDir));
    for (const chunk of allChunks) {
      if (existing.has(chunk.id)) {
        continue;
      }
      const fileName = `backfill-${createHash("sha256").update(chunk.id).digest("hex").slice(0, 16)}.json`;
      await fsp.writeFile(
        path.join(stmDir, fileName),
        `${JSON.stringify(
          {
            source: BACKFILL_SOURCE,
            id: chunk.id,
            relPath: chunk.relPath,
            startLine: chunk.startLine,
            endLine: chunk.endLine,
            score: 1,
            text: chunk.text,
            stagedAtMs: nowMs,
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      staged++;
    }
  }

  const day = formatMemoryDreamingDay(nowMs, params.timezone);
  const dreamsPath = path.join(params.workspaceDir, MEMORY_DREAMS_REL_PATH);
  let dreamsBody = "";
  try {
    dreamsBody = await fsp.readFile(dreamsPath, "utf8");
  } catch {
    dreamsBody = "# Dreams\n\n";
  }
  const header = `\n\n## Grounded backfill ${day}\n`;
  const lines = allChunks.slice(0, 40).map(
    (c) =>
      `- [${BACKFILL_SOURCE}] ${c.relPath}:${c.startLine}-${c.endLine} ${c.text.trim().replace(/\s+/g, " ").slice(0, 280)}`,
  );
  const block = `${dreamsBody.length > 0 && !dreamsBody.endsWith("\n") ? "\n" : ""}${header}${lines.join("\n")}\n`;
  await fsp.writeFile(dreamsPath, dreamsBody + block, "utf8");

  return {
    ok: true,
    staged,
    filesScanned: files.length,
    rolledBack: 0,
    message: `Grounded backfill staged ${staged} chunk(s) from ${files.length} file(s) into ${MEMORY_DREAMS_STM_DIR}/ and ${MEMORY_DREAMS_REL_PATH}.`,
  };
}
