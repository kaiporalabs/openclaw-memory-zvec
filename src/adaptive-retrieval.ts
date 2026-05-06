/** Heuristics inspired by production hybrid-memory plugins: skip cheap prompts, force memory-heavy prompts. */

const DEFAULT_SKIP_EN =
  /^(hi+|hello|hey|thanks|thank you|ok|okay|yes|no|sure|lol|haha)[\s!.]*$/i;
const DEFAULT_FORCE =
  /\b(remember|recall|last time|previously|before you forget|what did we|what did i)\b/i;

export type AdaptiveRetrievalInput = {
  query: string;
  /** When false, adaptive layer is bypassed */
  enabled: boolean;
  /** Minimum Latin-ish prompt length */
  minCharsEn: number;
  /** Minimum length for CJK-heavy prompts */
  minCharsCjk: number;
};

function cjkRatio(text: string): number {
  if (!text.trim()) return 0;
  let cjk = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x3040 && cp <= 0x30ff) ||
      (cp >= 0xac00 && cp <= 0xd7af)
    ) {
      cjk++;
    }
  }
  return cjk / [...text].length;
}

export function shouldSkipAdaptiveRecall(params: AdaptiveRetrievalInput): boolean {
  if (!params.enabled) return false;
  const q = params.query.trim();
  if (!q) return true;
  if (DEFAULT_FORCE.test(q)) return false;

  const ratio = cjkRatio(q);
  const threshold = ratio >= 0.35 ? params.minCharsCjk : params.minCharsEn;
  if (q.length < threshold) return true;

  const stripped = q.replace(/\s+/g, " ");
  if (stripped.length <= 12 && DEFAULT_SKIP_EN.test(stripped)) return true;

  return false;
}
