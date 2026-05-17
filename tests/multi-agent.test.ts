import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

async function setupAgent(agentId: string, memoryText: string) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "mzvec-agent-"));
  tmpRoots.push(root);
  const workspace = path.join(root, "ws");
  await fsp.mkdir(path.join(workspace, "memory"), { recursive: true });
  await fsp.writeFile(path.join(workspace, "MEMORY.md"), memoryText, "utf8");

  const cfg = memoryConfigSchema.parse(
    {
      embedding: { provider: "openai", model: "text-embedding-3-small", dimensions: MOCK_EMBED_DIM },
      dbPath: path.join(root, "zvec"),
      sqlitePath: path.join(root, `${agentId}.sqlite`),
      adaptive: { enabled: false },
    },
    { agentId },
  );
  const manager = new ZvecSqliteMemoryManager(
    cfg,
    workspace,
    agentId,
    createMockEmbeddings(),
    new MemoryZvecStore(cfg.dbPath!, MOCK_EMBED_DIM),
  );
  await manager.sync({ reason: "test", force: true });
  return manager;
}

describe("multi-agent isolation", () => {
  it("each agent searches only its workspace memory", async () => {
    const main = await setupAgent(
      "main",
      "The purple elephant dances only on Mars during equinox",
    );
    const kai = await setupAgent(
      "kai",
      "The yellow submarine dives only in Venus during solstice",
    );

    const mainHits = await main.search("purple elephant Mars equinox", {
      maxResults: 5,
      minScore: 0.01,
    });
    const kaiHits = await kai.search("yellow submarine Venus solstice", {
      maxResults: 5,
      minScore: 0.01,
    });
    const kaiWrong = await kai.search("purple elephant Mars equinox", {
      maxResults: 5,
      minScore: 0.15,
    });

    expect(mainHits.length).toBeGreaterThan(0);
    expect(kaiHits.length).toBeGreaterThan(0);
    const mainText = mainHits.map((r) => r.snippet).join(" ");
    const kaiText = kaiHits.map((r) => r.snippet).join(" ");
    expect(mainText).toMatch(/purple|elephant|Mars/i);
    expect(kaiText).toMatch(/yellow|submarine|Venus/i);
    expect(kaiWrong.every((r) => !/purple|elephant|Mars/i.test(r.snippet))).toBe(true);

    await main.close();
    await kai.close();
  });
});
