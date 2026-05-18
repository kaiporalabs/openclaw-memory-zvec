import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MEMORY_DREAMS_REL_PATH, MEMORY_DREAMS_STM_DIR } from "../src/dreaming/promotion.js";
import { runRemBackfill } from "../src/rem-backfill.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("runRemBackfill", () => {
  it("stages historical memory files and writes DREAMS.md", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocmz-backfill-"));
    tmpDirs.push(workspaceDir);
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceDir, "memory", "2026-05-01.md"),
      "# Old note\n\nUser prefers dark mode in all apps.\n",
      "utf8",
    );

    const result = await runRemBackfill({
      workspaceDir,
      memoryPath: "memory",
      stageShortTerm: true,
    });

    expect(result.ok).toBe(true);
    expect(result.staged).toBeGreaterThan(0);
    const dreams = await fs.readFile(path.join(workspaceDir, MEMORY_DREAMS_REL_PATH), "utf8");
    expect(dreams).toContain("Grounded backfill");
    expect(dreams).toContain("dark mode");
    const stm = await fs.readdir(path.join(workspaceDir, MEMORY_DREAMS_STM_DIR));
    expect(stm.some((name) => name.startsWith("backfill-"))).toBe(true);
  });

  it("rollback-short-term removes staged files", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocmz-backfill-rb-"));
    tmpDirs.push(workspaceDir);
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, "memory", "a.md"), "historical fact one\n", "utf8");

    await runRemBackfill({ workspaceDir, stageShortTerm: true });
    const rollback = await runRemBackfill({ workspaceDir, rollbackShortTerm: true });
    expect(rollback.rolledBack).toBeGreaterThan(0);
    const stm = await fs.readdir(path.join(workspaceDir, MEMORY_DREAMS_STM_DIR)).catch(() => []);
    expect(stm.filter((n) => n.startsWith("backfill-"))).toHaveLength(0);
  });
});
