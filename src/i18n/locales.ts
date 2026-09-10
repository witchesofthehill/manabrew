export const APP_LOCALES = {
  en: {
    label: "English",
    direction: "ltr",
    scryfallLanguage: "en",
  },
  es: {
    label: "Español",
    direction: "ltr",
    scryfallLanguage: "es",
  },
} as const;

export type AppLocale = keyof typeof APP_LOCALES;
export type AppLanguagePreference = "system" | AppLocale;
export type ScryfallLanguage = (typeof APP_LOCALES)[AppLocale]["scryfallLanguage"];

export const DEFAULT_LOCALE: AppLocale = "en";
export const DEFAULT_SCRYFALL_LANGUAGE: ScryfallLanguage =
  APP_LOCALES[DEFAULT_LOCALE].scryfallLanguage;

export function resolveAppLocale(languages: readonly string[]): AppLocale {
  for (const language of languages) {
    const normalized = language.toLowerCase();
    if (normalized in APP_LOCALES) return normalized as AppLocale;
    const base = normalized.split("-")[0];
    if (base in APP_LOCALES) return base as AppLocale;
  }
  return DEFAULT_LOCALE;
}

export function resolveLanguagePreference(preference: AppLanguagePreference): AppLocale {
  if (preference !== "system") return preference;
  return resolveAppLocale(typeof navigator === "undefined" ? [] : navigator.languages);
}
