import {
  detectCategory,
  formatRelevantMemoriesContext,
  normalizeRecallQuery,
  shouldCapture,
} from "./prompt-helpers.js";

export {
  detectCategory,
  formatRelevantMemoriesContext,
  normalizeRecallQuery,
  shouldCapture,
};

export const DEFAULT_AUTO_RECALL_TIMEOUT_MS = 15_000;

export type AutoCaptureCursor = {
  nextIndex: number;
  lastMessageFingerprint?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function extractUserTextContent(message: unknown): string[] {
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

  const texts: string[] = [];
  for (const block of content) {
    const blockObj = asRecord(block);
    if (blockObj?.type === "text" && typeof blockObj.text === "string") {
      texts.push(blockObj.text);
    }
  }
  return texts;
}

export function extractLatestUserText(messages: unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const text = extractUserTextContent(messages[index]).join("\n").trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

export function messageFingerprint(message: unknown): string {
  const msgObj = asRecord(message);
  if (!msgObj) {
    return `${typeof message}:${String(message)}`;
  }
  try {
    return JSON.stringify({
      role: msgObj.role,
      content: msgObj.content,
    });
  } catch {
    return `${String(msgObj.role)}:${String(msgObj.content)}`;
  }
}

export function resolveAutoCaptureStartIndex(
  messages: unknown[],
  cursor: AutoCaptureCursor | undefined,
): number {
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
