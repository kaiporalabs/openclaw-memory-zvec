import type { MemoryCategory } from "./config.js";
/** Lightweight capture normalization when smartExtraction is enabled (no LLM). */
export declare function refineCaptureText(text: string, maxChars: number): string;
export declare function formatSmartCaptureLine(params: {
    text: string;
    category: MemoryCategory;
    nowMs: number;
    maxChars: number;
}): string;
//# sourceMappingURL=smart-extraction.d.ts.map