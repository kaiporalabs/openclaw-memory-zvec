import { describe, expect, it } from "vitest";
import { resolveMemoryGetRelPath } from "../src/memory-get-params.js";

describe("resolveMemoryGetRelPath", () => {
  it("accepts path", () => {
    expect(resolveMemoryGetRelPath({ path: "memory/foo.md" })).toBe("memory/foo.md");
  });

  it("accepts relPath", () => {
    expect(resolveMemoryGetRelPath({ relPath: "MEMORY.md" })).toBe("MEMORY.md");
  });

  it("prefers relPath when both set", () => {
    expect(resolveMemoryGetRelPath({ path: "a.md", relPath: "b.md" })).toBe("b.md");
  });

  it("throws when empty", () => {
    expect(() => resolveMemoryGetRelPath({})).toThrow(/path or relPath is required/);
  });
});
