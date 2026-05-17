import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendMemoryNote } from "../src/markdown-memory.js";
import { memoryConfigSchema } from "../src/config.js";
import { ZvecSqliteMemoryManager } from "../src/memory-manager.js";
import { MemoryZvecStore } from "../src/zvec-store.js";
import { createMockEmbeddings, MOCK_EMBED_DIM } from "./helpers/mock-embeddings.js";

const tmpRoots: string[] = [];

afterEach(async () => {
  for (const root of tmpRoots.splice(0)) {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

describe("markdown-first store", () => {
  it("append + sync makes content searchable", async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mzvec-md-"));
    tmpRoots.push(root);
    const workspace = path.join(root, "ws");
    await fsp.mkdir(workspace, { recursive: true });

    const note = await appendMemoryNote({
      workspaceDir: workspace,
      text: "Favorite color is ultramarine blue",
      category: "preference",
      nowMs: Date.parse("2026-05-17T10:00:00Z"),
    });
    expect(note.appended).toBe(true);

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
      workspace,
      "main",
      createMockEmbeddings(),
      new MemoryZvecStore(cfg.dbPath!, MOCK_EMBED_DIM),
    );
    await manager.sync({ reason: "test", force: true });
    const hits = await manager.search("ultramarine blue color", { maxResults: 3, minScore: 0.01 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.snippet.toLowerCase().includes("ultramarine"))).toBe(true);
    await manager.close();
  });
});
