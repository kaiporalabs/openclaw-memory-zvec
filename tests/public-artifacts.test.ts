import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listMemoryZvecPublicArtifacts } from "../src/public-artifacts.js";

const fixtureWorkspace = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/workspace");

describe("listMemoryZvecPublicArtifacts", () => {
  it("lists MEMORY.md and memory daily notes", async () => {
    const artifacts = await listMemoryZvecPublicArtifacts({
      cfg: { agents: { list: [{ id: "main" }] } },
      resolveWorkspaceDir: () => fixtureWorkspace,
    });
    const paths = artifacts.map((a) => a.relativePath);
    expect(paths).toContain("MEMORY.md");
    expect(paths.some((p) => p.startsWith("memory/"))).toBe(true);
  });
});
