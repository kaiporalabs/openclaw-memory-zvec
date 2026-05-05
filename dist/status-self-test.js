import fsp from "node:fs/promises";
import { formatErrorDiagnostic } from "./error-diagnostic.js";
export async function probeFilesystemPath(absPath) {
    try {
        const st = await fsp.stat(absPath);
        const kind = st.isDirectory()
            ? "directory"
            : st.isFile()
                ? "file"
                : "unknown";
        return { path: absPath, ok: true, kind };
    }
    catch (err) {
        const code = err?.code;
        return {
            path: absPath,
            ok: false,
            kind: code === "ENOENT" ? "missing" : "unknown",
            ...(code !== "ENOENT" ? { error: formatErrorDiagnostic(err) } : {}),
        };
    }
}
export function computeStatusOverallOk(parts) {
    return (parts.workspaceDir.ok &&
        parts.sqlitePath.ok &&
        parts.zvecDataRoot.ok &&
        parts.zvecCollectionOk &&
        parts.embeddingOk &&
        parts.sqliteStatsOk);
}
//# sourceMappingURL=status-self-test.js.map