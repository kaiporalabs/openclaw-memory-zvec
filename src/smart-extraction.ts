import { truncateUtf16Safe } from "openclaw/plugin-sdk/text-runtime";
import type { MemoryCategory } from "./config.js";

/** Lightweight capture normalization when smartExtraction is enabled (no LLM). */
export function refineCaptureText(text: string, maxChars: number): string {
  let normalized = text.replace(/\s+/g, " ").trim();
  normalized = normalized.replace(/^(user|assistant|system)\s*:\s*/i, "");

  if (normalized.length > Math.max(80, Math.floor(maxChars * 0.65))) {
    const sentences = normalized.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g);
    if (sentences && sentences.length >= 2) {
      normalized = sentences
        .slice(0, 2)
        .join(" ")
        .trim();
    }
  }

  const limit = Math.max(40, Math.floor(maxChars));
  return normalized.length > limit ? truncateUtf16Safe(normalized, limit).trimEnd() : normalized;
}

export function formatSmartCaptureLine(params: {
  text: string;
  category: MemoryCategory;
  nowMs: number;
  maxChars: number;
}): string {
  const body = refineCaptureText(params.text, params.maxChars);
  const iso = new Date(params.nowMs).toISOString();
  return `- [${params.category}] ${iso} ${body}`;
}
