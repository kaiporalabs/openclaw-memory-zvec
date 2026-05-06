import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Ensure a directory exists (create parents) and is writable for SQLite/Zvec data.
 */
export function validateWritableDirectory(rawPath) {
    const trimmed = rawPath.trim();
    if (!trimmed) {
        return { ok: false, resolvedPath: "", error: "path is empty", hint: "Set dbPath in plugin config." };
    }
    if (trimmed.includes("://") && !trimmed.startsWith("file:")) {
        return {
            ok: false,
            resolvedPath: trimmed,
            error: "non-local URI cannot be validated as a writable directory",
        };
    }
    let resolved = trimmed;
    try {
        if (trimmed.startsWith("file:")) {
            resolved = fileURLToPath(new URL(trimmed));
        }
    }
    catch {
        return { ok: false, resolvedPath: trimmed, error: "invalid file: URI" };
    }
    resolved = path.resolve(resolved);
    try {
        fs.mkdirSync(resolved, { recursive: true });
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            resolvedPath: resolved,
            error: `cannot create directory: ${msg}`,
            hint: "Check permissions or choose another dbPath.",
        };
    }
    try {
        fs.accessSync(resolved, fs.constants.W_OK | fs.constants.R_OK);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            resolvedPath: resolved,
            error: `directory not readable/writable: ${msg}`,
            hint: "chmod or pick a path your user owns.",
        };
    }
    return { ok: true, resolvedPath: resolved };
}
//# sourceMappingURL=path-validation.js.map