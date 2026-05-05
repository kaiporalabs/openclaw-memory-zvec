import { detectCategory, formatRelevantMemoriesContext, normalizeRecallQuery, shouldCapture } from "./prompt-helpers.js";
export { detectCategory, formatRelevantMemoriesContext, normalizeRecallQuery, shouldCapture, };
export declare const DEFAULT_AUTO_RECALL_TIMEOUT_MS = 15000;
export type AutoCaptureCursor = {
    nextIndex: number;
    lastMessageFingerprint?: string;
};
export declare function extractUserTextContent(message: unknown): string[];
export declare function extractLatestUserText(messages: unknown[]): string | undefined;
export declare function messageFingerprint(message: unknown): string;
export declare function resolveAutoCaptureStartIndex(messages: unknown[], cursor: AutoCaptureCursor | undefined): number;
//# sourceMappingURL=runtime-helpers.d.ts.map