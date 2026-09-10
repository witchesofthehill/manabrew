import { activateLocale } from "@/i18n/i18n";
import { resolveLanguagePreference } from "@/i18n/locales";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

let initialized = false;
let appliedPreference = usePreferencesStore.getState().appLanguage;

async function applyPreference(): Promise<void> {
  const preference = usePreferencesStore.getState().appLanguage;
  const locale = resolveLanguagePreference(preference);
  await activateLocale(locale);
}

export async function initializeLocalization(): Promise<void> {
  if (!initialized) {
    initialized = true;
    usePreferencesStore.subscribe((state) => {
      if (state.appLanguage === appliedPreference) return;
      appliedPreference = state.appLanguage;
      void applyPreference();
    });
    window.addEventListener("languagechange", () => {
      if (usePreferencesStore.getState().appLanguage === "system") void applyPreference();
    });
  }
  await applyPreference();
}
