/** FTS5 reserved keywords (case-insensitive). */
const FTS5_RESERVED = new Set([
  "and",
  "or",
  "not",
  "near",
  "column",
  "match",
  "filter",
]);

/**
 * Build a safe FTS5 MATCH string from free-text user/agent queries.
 * Returns null when there are no usable tokens (caller should skip FTS).
 */
export function buildFtsMatchQuery(raw: string): string | null {
  const normalized = raw
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }

  const tokens = normalized
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .filter((t) => !FTS5_RESERVED.has(t));

  if (tokens.length === 0) {
    return null;
  }

  return tokens.map((t) => `"${t.replaceAll('"', '""')}"`).join(" AND ");
}
