import fsp from "node:fs/promises";
import { formatErrorDiagnostic } from "./error-diagnostic.js";

export type PathProbeResult = {
  path: string;
  ok: boolean;
  kind: "file" | "directory" | "missing" | "unknown";
  error?: string;
};

export async function probeFilesystemPath(absPath: string): Promise<PathProbeResult> {
  try {
    const st = await fsp.stat(absPath);
    const kind: PathProbeResult["kind"] = st.isDirectory()
      ? "directory"
      : st.isFile()
        ? "file"
        : "unknown";
    return { path: absPath, ok: true, kind };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return {
      path: absPath,
      ok: false,
      kind: code === "ENOENT" ? "missing" : "unknown",
      ...(code !== "ENOENT" ? { error: formatErrorDiagnostic(err) } : {}),
    };
  }
}

export function computeStatusOverallOk(parts: {
  workspaceDir: PathProbeResult;
  sqlitePath: PathProbeResult;
  zvecDataRoot: PathProbeResult;
  zvecCollectionOk: boolean;
  embeddingOk: boolean;
  sqliteStatsOk: boolean;
}): boolean {
  return (
    parts.workspaceDir.ok &&
    parts.sqlitePath.ok &&
    parts.zvecDataRoot.ok &&
    parts.zvecCollectionOk &&
    parts.embeddingOk &&
    parts.sqliteStatsOk
  );
}
