const LANGUAGE_FILTER = /(?:^|[\s(])-?(?:lang|language):([a-z0-9-]+)(?=$|[\s)])/gi;

function languageFilters(query: string): string[] {
  return [...query.matchAll(LANGUAGE_FILTER)].map((match) => match[1]?.toLowerCase() ?? "");
}

export function withAnyScryfallLanguage(query: string): string {
  if (!query.trim() || languageFilters(query).length > 0) return query;
  return `${query.trim()} lang:any`;
}

export function shouldLocalizeScryfallSearchResults(query: string): boolean {
  return !languageFilters(query).some((language) => language !== "any");
}
