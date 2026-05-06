import { detectCategory, formatRelevantMemoriesContext, normalizeRecallQuery, shouldCapture, } from "./prompt-helpers.js";
export { detectCategory, formatRelevantMemoriesContext, normalizeRecallQuery, shouldCapture, };
export { DEFAULT_AUTO_RECALL_TIMEOUT_MS } from "./config.js";
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : undefined;
}
export function extractUserTextContent(message) {
    const msgObj = asRecord(message);
    if (!msgObj || msgObj.role !== "user") {
        return [];
    }
    const content = msgObj.content;
    if (typeof content === "string") {
        return [content];
    }
    if (!Array.isArray(content)) {
        return [];
    }
    const texts = [];
    for (const block of content) {
        const blockObj = asRecord(block);
        if (blockObj?.type === "text" && typeof blockObj.text === "string") {
            texts.push(blockObj.text);
        }
    }
    return texts;
}
export function extractLatestUserText(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
        const text = extractUserTextContent(messages[index]).join("\n").trim();
        if (text) {
            return text;
        }
    }
    return undefined;
}
export function messageFingerprint(message) {
    const msgObj = asRecord(message);
    if (!msgObj) {
        return `${typeof message}:${String(message)}`;
    }
    try {
        return JSON.stringify({
            role: msgObj.role,
            content: msgObj.content,
        });
    }
    catch {
        return `${String(msgObj.role)}:${String(msgObj.content)}`;
    }
}
export function resolveAutoCaptureStartIndex(messages, cursor) {
    if (!cursor) {
        return 0;
    }
    if (cursor.lastMessageFingerprint && cursor.nextIndex > 0) {
        for (let index = messages.length - 1; index >= 0; index--) {
            if (messageFingerprint(messages[index]) === cursor.lastMessageFingerprint) {
                return index + 1;
            }
        }
        return 0;
    }
    if (cursor.nextIndex <= messages.length) {
        return cursor.nextIndex;
    }
    return 0;
}
//# sourceMappingURL=runtime-helpers.js.map