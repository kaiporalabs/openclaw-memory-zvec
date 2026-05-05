/**
 * Human-readable error formatting for logs (`warn` / gateway output).
 *
 * Walks `Error.cause` and `AggregateError.errors` so messages like `fetch failed` include the
 * underlying network cause. Used across hooks (`index.ts`), `ZvecSqliteMemoryManager`, and startup.
 *
 * @see `describeEmbeddingEndpoint` for safe embedding endpoint summaries (provider/model/host only).
 */
import type { MemoryConfig } from "./config.js";

export function formatErrorDiagnostic(err: unknown): string {
  if (err === null || err === undefined) {
    return String(err);
  }
  if (typeof err !== "object") {
    return String(err);
  }

  const parts: string[] = [];
  const base = err instanceof Error ? err : new Error(String(err));
  parts.push(base.message || String(err));

  let cur: unknown = base.cause;
  let depth = 0;
  while (cur != null && depth < 8) {
    if (cur instanceof Error) {
      parts.push(`cause: ${cur.message}`);
      cur = cur.cause;
    } else if (
      typeof cur === "object" &&
      cur !== null &&
      "errors" in cur &&
      Array.isArray((cur as AggregateError).errors)
    ) {
      const agg = cur as AggregateError;
      for (const sub of agg.errors.slice(0, 4)) {
        parts.push(`aggregate: ${formatErrorDiagnostic(sub)}`);
      }
      break;
    } else {
      parts.push(`cause: ${String(cur)}`);
      break;
    }
    depth++;
  }

  return parts.join(" | ");
}

export function describeEmbeddingEndpoint(embedding: MemoryConfig["embedding"]): string {
  let host = "";
  if (embedding.baseUrl) {
    try {
      host = new URL(embedding.baseUrl).hostname;
    } catch {
      host = "(invalid baseUrl)";
    }
  }
  const parts = [`provider=${embedding.provider}`, `model=${embedding.model}`];
  if (host) {
    parts.push(`host=${host}`);
  }
  return parts.join(" ");
}
