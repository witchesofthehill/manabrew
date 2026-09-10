import { messages as englishMessages } from "@/i18n/locales/en/messages.po";
import { setupI18n } from "@lingui/core";
import { APP_LOCALES, type AppLocale } from "@/i18n/locales";

export const i18n = setupI18n({
  locale: "en",
  messages: { en: englishMessages },
});

let activationSequence = 0;

async function loadMessages(locale: AppLocale) {
  switch (locale) {
    case "de":
      return import("@/i18n/locales/de/messages.po");
    case "es":
      return import("@/i18n/locales/es/messages.po");
    case "fr":
      return import("@/i18n/locales/fr/messages.po");
    case "it":
      return import("@/i18n/locales/it/messages.po");
    case "ja":
      return import("@/i18n/locales/ja/messages.po");
    case "ko":
      return import("@/i18n/locales/ko/messages.po");
    case "pt":
      return import("@/i18n/locales/pt/messages.po");
    case "ru":
      return import("@/i18n/locales/ru/messages.po");
    case "zh-Hans":
      return import("@/i18n/locales/zh-Hans/messages.po");
    case "zh-Hant":
      return import("@/i18n/locales/zh-Hant/messages.po");
    case "en":
      return { messages: englishMessages };
  }
}

export async function activateLocale(locale: AppLocale): Promise<void> {
  const sequence = ++activationSequence;
  const { messages } = await loadMessages(locale);
  if (sequence !== activationSequence) return;

  i18n.loadAndActivate({ locale, messages });
  document.documentElement.lang = locale;
  document.documentElement.dir = APP_LOCALES[locale].direction;
}
