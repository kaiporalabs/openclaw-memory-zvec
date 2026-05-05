import { DEFAULT_CAPTURE_MAX_CHARS, DEFAULT_RECALL_MAX_CHARS, type MemoryCategory, MEMORY_CATEGORIES } from "./config.js";
export { DEFAULT_CAPTURE_MAX_CHARS, DEFAULT_RECALL_MAX_CHARS, MEMORY_CATEGORIES };
export type { MemoryCategory };
export declare function normalizeRecallQuery(text: string, maxChars?: number): string;
export declare function looksLikePromptInjection(text: string): boolean;
export declare function escapeMemoryForPrompt(text: string): string;
export declare function formatRelevantMemoriesContext(memories: Array<{
    category: MemoryCategory;
    text: string;
}>): string;
export declare function shouldCapture(text: string, options?: {
    maxChars?: number;
}): boolean;
export declare function detectCategory(text: string): MemoryCategory;
//# sourceMappingURL=prompt-helpers.d.ts.map