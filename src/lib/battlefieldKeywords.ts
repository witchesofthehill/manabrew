const KEYWORD_LABEL_MAX_LEN = 14;
const INTERNAL_KEYWORD_LABELS: Record<string, true> = { ETBReplacement: true };

export function isVisibleBattlefieldKeyword(keyword: string): boolean {
  const label = keyword.split(":")[0]!.trim();
  return (
    label.length > 0 && label.length <= KEYWORD_LABEL_MAX_LEN && !INTERNAL_KEYWORD_LABELS[label]
  );
}

export function battlefieldKeywords(
  keywords: string[] | undefined,
  max = 4,
): { shown: string[]; hidden: number } {
  if (!keywords || keywords.length === 0) return { shown: [], hidden: 0 };
  const labels = keywords
    .filter(isVisibleBattlefieldKeyword)
    .map((keyword) => keyword.split(":")[0]!.trim());
  const unique = [...new Set(labels)];
  return { shown: unique.slice(0, max), hidden: Math.max(0, unique.length - max) };
}
