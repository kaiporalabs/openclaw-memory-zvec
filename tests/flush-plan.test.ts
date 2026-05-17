import { describe, expect, it } from "vitest";
import { buildMemoryZvecFlushPlan } from "../src/flush-plan.js";

describe("buildMemoryZvecFlushPlan", () => {
  it("returns daily memory path and safety hints", () => {
    const plan = buildMemoryZvecFlushPlan({ nowMs: Date.parse("2026-05-17T15:00:00Z") });
    expect(plan).not.toBeNull();
    expect(plan!.relativePath).toMatch(/^memory\/\d{4}-\d{2}-\d{2}\.md$/);
    expect(plan!.prompt).toContain("memory/");
    expect(plan!.prompt).toContain("APPEND");
    expect(plan!.systemPrompt).toContain("MEMORY.md");
  });

  it("returns null when disabled", () => {
    const plan = buildMemoryZvecFlushPlan({
      cfg: {
        agents: { defaults: { compaction: { memoryFlush: { enabled: false } } } },
      },
    });
    expect(plan).toBeNull();
  });
});
