export function formatErrorDiagnostic(err) {
    if (err === null || err === undefined) {
        return String(err);
    }
    if (typeof err !== "object") {
        return String(err);
    }
    const parts = [];
    const base = err instanceof Error ? err : new Error(String(err));
    parts.push(base.message || String(err));
    let cur = base.cause;
    let depth = 0;
    while (cur != null && depth < 8) {
        if (cur instanceof Error) {
            parts.push(`cause: ${cur.message}`);
            cur = cur.cause;
        }
        else if (typeof cur === "object" &&
            cur !== null &&
            "errors" in cur &&
            Array.isArray(cur.errors)) {
            const agg = cur;
            for (const sub of agg.errors.slice(0, 4)) {
                parts.push(`aggregate: ${formatErrorDiagnostic(sub)}`);
            }
            break;
        }
        else {
            parts.push(`cause: ${String(cur)}`);
            break;
        }
        depth++;
    }
    return parts.join(" | ");
}
export function describeEmbeddingEndpoint(embedding) {
    let host = "";
    if (embedding.baseUrl) {
        try {
            host = new URL(embedding.baseUrl).hostname;
        }
        catch {
            host = "(invalid baseUrl)";
        }
    }
    const parts = [`provider=${embedding.provider}`, `model=${embedding.model}`];
    if (host) {
        parts.push(`host=${host}`);
    }
    return parts.join(" ");
}
//# sourceMappingURL=error-diagnostic.js.map