import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { memoryConfigSchema } from "../src/config.js";
import { ZvecSqliteMemoryManager } from "../src/memory-manager.js";
import { MemoryZvecStore } from "../src/zvec-store.js";
import { createMockEmbeddings, MOCK_EMBED_DIM } from "./helpers/mock-embeddings.js";

const fixtureWorkspace = path.join(import.meta.dirname, "fixtures/workspace");
const tmpRoots: string[] = [];

afterEach(async () => {
  for (const root of tmpRoots.splice(0)) {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

async function createManager(workspaceDir: string) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mzvec-test-"));
  tmpRoots.push(root);
  const cfg = memoryConfigSchema.parse(
    {
      embedding: { provider: "openai", model: "text-embedding-3-small", dimensions: MOCK_EMBED_DIM },
      dbPath: path.join(root, "zvec"),
      sqlitePath: path.join(root, "mem.sqlite"),
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
  return manager;
}

describe("ZvecSqliteMemoryManager sync", () => {
  it("indexes MEMORY.md and finds tea via search", async () => {
    const manager = await createManager(fixtureWorkspace);
    await manager.sync({ reason: "test", force: true });
    const results = await manager.search("tea coffee preference", { maxResults: 5, minScore: 0.01 });
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.snippet.toLowerCase().includes("tea"))).toBe(true);
    await manager.close();
  });

  it("allows concurrent sync without database locked", async () => {
    const manager = await createManager(fixtureWorkspace);
    await Promise.all([
      manager.sync({ reason: "a", force: true }),
      manager.sync({ reason: "b", force: true }),
    ]);
    await manager.close();
  });
});
