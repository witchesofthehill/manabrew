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
  fr: {
    label: "Français",
    direction: "ltr",
    scryfallLanguage: "fr",
  },
  de: {
    label: "Deutsch",
    direction: "ltr",
    scryfallLanguage: "de",
  },
  it: {
    label: "Italiano",
    direction: "ltr",
    scryfallLanguage: "it",
  },
  pt: {
    label: "Português",
    direction: "ltr",
    scryfallLanguage: "pt",
  },
  ja: {
    label: "日本語",
    direction: "ltr",
    scryfallLanguage: "ja",
  },
  ko: {
    label: "한국어",
    direction: "ltr",
    scryfallLanguage: "ko",
  },
  ru: {
    label: "Русский",
    direction: "ltr",
    scryfallLanguage: "ru",
  },
  "zh-Hans": {
    label: "简体中文",
    direction: "ltr",
    scryfallLanguage: "zhs",
  },
  "zh-Hant": {
    label: "繁體中文",
    direction: "ltr",
    scryfallLanguage: "zht",
  },
} as const;

export type AppLocale = keyof typeof APP_LOCALES;
export type AppLanguagePreference = "system" | AppLocale;
export type ScryfallLanguage = (typeof APP_LOCALES)[AppLocale]["scryfallLanguage"];

export const DEFAULT_LOCALE: AppLocale = "en";
export const DEFAULT_SCRYFALL_LANGUAGE: ScryfallLanguage =
  APP_LOCALES[DEFAULT_LOCALE].scryfallLanguage;
const REGISTERED_LOCALES = Object.keys(APP_LOCALES) as AppLocale[];

export function resolveAppLocale(languages: readonly string[]): AppLocale {
  for (const language of languages) {
    const normalized = language.replaceAll("_", "-").toLowerCase();
    if (
      normalized === "zh" ||
      normalized === "zh-cn" ||
      normalized === "zh-sg" ||
      normalized.startsWith("zh-hans")
    ) {
      return "zh-Hans";
    }
    if (
      normalized === "zh-tw" ||
      normalized === "zh-hk" ||
      normalized === "zh-mo" ||
      normalized.startsWith("zh-hant")
    ) {
      return "zh-Hant";
    }
    const exact = REGISTERED_LOCALES.find((locale) => locale.toLowerCase() === normalized);
    if (exact) return exact;
    const base = normalized.split("-")[0];
    const baseLocale = REGISTERED_LOCALES.find((locale) => locale.toLowerCase() === base);
    if (baseLocale) return baseLocale;
  }
  return DEFAULT_LOCALE;
}

export function resolveLanguagePreference(preference: AppLanguagePreference): AppLocale {
  if (preference !== "system") return preference;
  return resolveAppLocale(typeof navigator === "undefined" ? [] : navigator.languages);
}
