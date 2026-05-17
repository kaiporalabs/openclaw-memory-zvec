import { describe, expect, it } from "vitest";
import { buildFtsMatchQuery } from "../src/fts-query.js";

describe("buildFtsMatchQuery", () => {
  it("quotes tokens and joins with AND", () => {
    expect(buildFtsMatchQuery("purple elephant")).toBe('"purple" AND "elephant"');
  });

  it("strips punctuation that breaks FTS5", () => {
    expect(buildFtsMatchQuery("info.")).toBe('"info"');
    expect(buildFtsMatchQuery("foo.bar baz")).toBe('"foo" AND "bar" AND "baz"');
  });

  it("returns null for empty or token-less input", () => {
    expect(buildFtsMatchQuery("")).toBeNull();
    expect(buildFtsMatchQuery(". .")).toBeNull();
    expect(buildFtsMatchQuery("a")).toBeNull();
  });

  it("filters FTS reserved words", () => {
    expect(buildFtsMatchQuery("NOT important")).toBe('"important"');
  });
});
