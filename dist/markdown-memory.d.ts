import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import type { MemoryCategory } from "./config.js";
export declare function appendMemoryNote(params: {
    workspaceDir: string;
    text: string;
    category?: MemoryCategory;
    nowMs?: number;
    cfg?: OpenClawConfig;
}): Promise<{
    relPath: string;
    appended: boolean;
}>;
//# sourceMappingURL=markdown-memory.d.ts.map