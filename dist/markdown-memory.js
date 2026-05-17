import fsp from "node:fs/promises";
import path from "node:path";
import { resolveDailyMemoryRelPath } from "./memory-date.js";
export async function appendMemoryNote(params) {
    const relPath = resolveDailyMemoryRelPath({ cfg: params.cfg, nowMs: params.nowMs });
    const absPath = path.join(params.workspaceDir, relPath);
    const category = params.category ?? "other";
    const nowMs = params.nowMs ?? Date.now();
    const iso = new Date(nowMs).toISOString();
    const line = `- [${category}] ${iso} ${params.text.trim()}\n`;
    await fsp.mkdir(path.dirname(absPath), { recursive: true });
    let existing = "";
    try {
        existing = await fsp.readFile(absPath, "utf8");
    }
    catch {
        // new file
    }
    const normalizedNew = params.text.trim().toLowerCase();
    if (existing.toLowerCase().includes(normalizedNew)) {
        return { relPath, appended: false };
    }
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await fsp.appendFile(absPath, `${prefix}${line}`, "utf8");
    return { relPath, appended: true };
}
//# sourceMappingURL=markdown-memory.js.map