import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import { type MemoryFlushPlan } from "openclaw/plugin-sdk/memory-core-host-runtime-core";
export declare const DEFAULT_MEMORY_FLUSH_SOFT_TOKENS = 4000;
export declare const DEFAULT_MEMORY_FLUSH_FORCE_TRANSCRIPT_BYTES: number;
export declare const DEFAULT_MEMORY_FLUSH_PROMPT: string;
export declare function buildMemoryZvecFlushPlan(params?: {
    cfg?: OpenClawConfig;
    nowMs?: number;
}): MemoryFlushPlan | null;
//# sourceMappingURL=flush-plan.d.ts.map