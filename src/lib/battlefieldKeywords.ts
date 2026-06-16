/** Picks the keyword labels worth showing on a battlefield tile. Forge ships
 *  some keywords as full prose (e.g. "After you roll a die, you may…"); the
 *  length cap drops those so the strip stays a clean list of real keywords.
 *  The part before a colon is the keyword name (the rest is its cost). */
const KEYWORD_LABEL_MAX_LEN = 14;

export function battlefieldKeywords(
  keywords: string[] | undefined,
  max = 4,
): { shown: string[]; hidden: number } {
  if (!keywords || keywords.length === 0) return { shown: [], hidden: 0 };
  const labels = keywords
    .map((k) => k.split(":")[0]!.trim())
    .filter((l) => l.length > 0 && l.length <= KEYWORD_LABEL_MAX_LEN);
  const unique = [...new Set(labels)];
  return { shown: unique.slice(0, max), hidden: Math.max(0, unique.length - max) };
}
