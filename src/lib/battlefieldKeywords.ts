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
