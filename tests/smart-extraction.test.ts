import { describe, expect, it } from "vitest";
import { refineCaptureText } from "../src/smart-extraction.js";

describe("refineCaptureText", () => {
  it("trims role prefixes and shortens long multi-sentence input", () => {
    const raw =
      "user: Please remember that I prefer PostgreSQL for all new services. " +
      "Also we decided to use pnpm in the monorepo. " +
      "Third unrelated sentence should often be dropped.";
    const out = refineCaptureText(raw, 200);
    expect(out).not.toMatch(/^user:/i);
    expect(out).toContain("PostgreSQL");
    expect(out.length).toBeLessThanOrEqual(200);
  });
});
