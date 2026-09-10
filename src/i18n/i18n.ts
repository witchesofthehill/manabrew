import { setupI18n } from "@lingui/core";
import { APP_LOCALES, type AppLocale } from "@/i18n/locales";

export const i18n = setupI18n();

let activationSequence = 0;

async function loadMessages(locale: AppLocale) {
  switch (locale) {
    case "es":
      return import("@/i18n/locales/es/messages.po");
    case "en":
      return import("@/i18n/locales/en/messages.po");
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
