function padLabel(label, width) {
    const t = label.length <= width ? label : `${label.slice(0, width - 1)}…`;
    return t.padEnd(width);
}
function section(title) {
    const line = "─".repeat(Math.min(title.length + 2, 56));
    return `\n${title}\n${line}\n`;
}
function kvBlock(rows, labelWidth = 22) {
    const w = Math.max(labelWidth, ...rows.map(([a]) => a.length));
    return rows.map(([k, v]) => `  ${padLabel(k, w)}  ${v}`).join("\n");
}
function truncatePath(p, max = 76) {
    if (p == null || p === "")
        return "—";
    if (p.length <= max)
        return p;
    const keep = max - 3;
    const head = Math.ceil(keep / 2);
    const tail = Math.floor(keep / 2);
    return `${p.slice(0, head)}...${p.slice(p.length - tail)}`;
}
function formatSelfTest(st) {
    const checked = new Date(st.checkedAtMs).toISOString().replace("T", " ").slice(0, 19);
    const lines = [];
    lines.push(section("Self-test (memory-zvec)"));
    lines.push(kvBlock([
        ["Checked at", checked],
        ["Overall", st.overallOk ? "OK" : "FAIL"],
        ["Embedding endpoint", st.embeddingEndpointSummary],
    ]));
    const pathRows = [
        [
            "Workspace",
            `${st.workspaceDir.ok ? "OK" : "FAIL"}  ${truncatePath(st.workspaceDir.path)} (${st.workspaceDir.kind})`,
        ],
        [
            "SQLite store",
            `${st.sqlitePath.ok ? "OK" : "FAIL"}  ${truncatePath(st.sqlitePath.path)} (${st.sqlitePath.kind})`,
        ],
        [
            "Zvec data root",
            `${st.zvecDataRoot.ok ? "OK" : "FAIL"}  ${truncatePath(st.zvecDataRoot.path)} (${st.zvecDataRoot.kind})`,
        ],
    ];
    lines.push(section("Paths on disk"));
    lines.push(kvBlock(pathRows, 18));
    const z = st.zvecCollection;
    const zvecLine = z.ok && typeof z.docCount === "number"
        ? `OK  docCount=${z.docCount}`
        : `FAIL${z.error ? `  ${z.error}` : ""}`;
    lines.push(section("Zvec collection"));
    lines.push(`  ${zvecLine}`);
    const emb = st.embedding;
    const embParts = [
        emb.ok ? "OK" : "FAIL",
        emb.checked ? "checked" : "not checked",
        typeof emb.checkedAtMs === "number"
            ? `at ${new Date(emb.checkedAtMs).toISOString().replace("T", " ").slice(0, 19)}`
            : "",
        emb.error ? `error: ${emb.error}` : "",
    ].filter(Boolean);
    lines.push(section("Embedding probe"));
    lines.push(`  ${embParts.join("  ·  ")}`);
    const sql = st.sqlite;
    const sqlLine = sql.ok && typeof sql.files === "number" && typeof sql.chunks === "number"
        ? `OK  files=${sql.files}  chunks=${sql.chunks}`
        : `FAIL${sql.error ? `  ${sql.error}` : ""}`;
    lines.push(section("SQLite / FTS"));
    lines.push(`  ${sqlLine}`);
    lines.push(section("Corpus roots present"));
    lines.push(st.memoryCorpusRootsPresent.length > 0
        ? `  ${st.memoryCorpusRootsPresent.join(", ")}`
        : "  (none detected)");
    if (st.notes.length > 0) {
        lines.push(section("Notes"));
        for (const n of st.notes) {
            lines.push(`  • ${n}`);
        }
    }
    return lines.join("\n");
}
/**
 * Human-readable CLI output for `memory status` / `memory-zvec status` / `verify`.
 * Use `--json` on those commands for machine-readable output.
 */
export function formatMemoryStatusHuman(status) {
    const custom = status.custom;
    const fts = status.fts ?? { enabled: false, available: false };
    const vec = status.vector ?? { enabled: false, available: false };
    const ftsErr = fts && typeof fts === "object" && "error" in fts && fts.error ? String(fts.error) : "";
    const ftsLine = [
        fts.enabled ? "enabled" : "disabled",
        fts.available ? "available" : "unavailable",
        ftsErr,
    ]
        .filter(Boolean)
        .join(" · ");
    const vecParts = [
        vec.enabled ? "enabled" : "disabled",
        vec.available ? "available" : "unavailable",
        typeof vec.dims === "number" ? `${vec.dims} dims` : "",
        vec && typeof vec === "object" && "loadError" in vec && vec.loadError ? String(vec.loadError) : "",
    ].filter(Boolean);
    const lines = [];
    lines.push("Memory status");
    lines.push("═════════════");
    lines.push(section("Overview"));
    lines.push(kvBlock([
        ["Backend", String(status.backend)],
        ["Embedding provider", String(status.provider)],
        ["Model", String(status.model)],
        ["Indexed files", String(status.files)],
        ["Chunks", String(status.chunks)],
        ["Index dirty", status.dirty ? "yes" : "no"],
        ["Sources", Array.isArray(status.sources) ? status.sources.join(", ") : "—"],
    ]));
    lines.push(section("Paths"));
    lines.push(kvBlock([
        ["Workspace", truncatePath(status.workspaceDir)],
        ["SQLite DB", truncatePath(status.dbPath)],
        ["Zvec data root", truncatePath(custom?.zvecDataRoot ?? "—")],
    ]));
    lines.push(section("Search backends"));
    lines.push(kvBlock([
        ["FTS / SQLite", ftsLine],
        ["Vector (Zvec)", vecParts.join(" · ")],
    ]));
    if (!custom?.memoryZvecStatusSelfTest && custom?.embeddingEndpointSummary) {
        lines.push(section("Embedding (summary)"));
        lines.push(`  ${custom.embeddingEndpointSummary}`);
    }
    if (custom?.memoryZvecStatusSelfTest) {
        lines.push(formatSelfTest(custom.memoryZvecStatusSelfTest));
    }
    return lines.join("\n").trimEnd() + "\n";
}
export function formatMemoryStatusCliOutput(payload) {
    if (payload.json) {
        return `${JSON.stringify(payload.ok ? { ok: true, status: payload.status } : { ok: false, error: payload.error }, null, 2)}\n`;
    }
    if (!payload.ok) {
        return `Error: ${payload.error ?? "unknown"}\n`;
    }
    if (!payload.status) {
        return "Error: status unavailable\n";
    }
    return formatMemoryStatusHuman(payload.status);
}
//# sourceMappingURL=format-memory-status-cli.js.map