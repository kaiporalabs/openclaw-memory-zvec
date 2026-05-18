import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { memoryConfigSchema } from "../src/config.js";
import { ZvecSqliteMemoryManager } from "../src/memory-manager.js";
import { MemoryZvecStore } from "../src/zvec-store.js";
import { createMockEmbeddings, MOCK_EMBED_DIM } from "./helpers/mock-embeddings.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeManager(params?: { seedFile?: string; seedText?: string }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ocmz-parity-"));
  tmpDirs.push(root);
  const workspaceDir = path.join(root, "workspace");
  const dbPath = path.join(root, "zvec");
  const sqlitePath = path.join(root, "mem.sqlite");
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });

  if (params?.seedFile && params?.seedText !== undefined) {
    await fs.writeFile(path.join(workspaceDir, params.seedFile), params.seedText, "utf8");
  }

  const cfg = memoryConfigSchema.parse(
    {
      embedding: { provider: "openai", model: "text-embedding-3-small", dimensions: MOCK_EMBED_DIM },
      dbPath,
      sqlitePath,
    },
    { agentId: "main" },
  );
  const manager = new ZvecSqliteMemoryManager(
    cfg,
    workspaceDir,
    "main",
    createMockEmbeddings(),
    new MemoryZvecStore(cfg.dbPath!, MOCK_EMBED_DIM),
  );
  return { manager, workspaceDir };
}

describe("sync index parity", () => {
  it("prunes sqlite chunks when a workspace file is removed", async () => {
    const rel = "memory/removed.md";
    const { manager, workspaceDir } = await makeManager({
      seedFile: rel,
      seedText: "line one\nline two\n",
    });
    await manager.sync({ reason: "test", force: true });
    let st = manager.status();
    expect(st.chunks).toBeGreaterThan(0);

    await fs.unlink(path.join(workspaceDir, rel));
    await manager.sync({ reason: "test", force: true });
    st = manager.status();
    expect(st.chunks).toBe(0);
    expect(st.files).toBe(0);
    await manager.close();
  });

  it("reconciles zvec vectors for all sqlite chunks after sync", async () => {
    const { manager } = await makeManager({
      seedFile: "MEMORY.md",
      seedText: "# Memory\n\nAlpha beta gamma delta.\n\nSecond paragraph here.\n",
    });
    await manager.sync({ reason: "test", force: true });
    await manager.runStatusSelfTest();
    const st = manager.status();
    const zvecCount = (st.custom as { zvecDocCount?: number } | undefined)?.zvecDocCount;
    expect(st.chunks).toBeGreaterThan(0);
    expect(zvecCount).toBeGreaterThan(0);
    expect(zvecCount).toBe(st.chunks);
    await manager.close();
  });
});

describe("memory_get index fallback", () => {
  it("reads from the index when the file was deleted from disk", async () => {
    const rel = "memory/stale.md";
    const { manager, workspaceDir } = await makeManager({
      seedFile: rel,
      seedText: "user: hello from indexed memory\n",
    });
    await manager.sync({ reason: "test", force: true });
    await fs.unlink(path.join(workspaceDir, rel));

    const result = await manager.readFile({ relPath: rel, from: 1, lines: 5 });
    expect(result.text).toContain("hello from indexed memory");
    await manager.close();
  });
});
