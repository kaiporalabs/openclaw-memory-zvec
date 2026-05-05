/**
 * Human-readable error formatting for logs (`warn` / gateway output).
 *
 * Walks `Error.cause` and `AggregateError.errors` so messages like `fetch failed` include the
 * underlying network cause. Used across hooks (`index.ts`), `ZvecSqliteMemoryManager`, and startup.
 *
 * @see `describeEmbeddingEndpoint` for safe embedding endpoint summaries (provider/model/host only).
 */
import type { MemoryConfig } from "./config.js";
export declare function formatErrorDiagnostic(err: unknown): string;
export declare function describeEmbeddingEndpoint(embedding: MemoryConfig["embedding"]): string;
//# sourceMappingURL=error-diagnostic.d.ts.map