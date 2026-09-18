import { PreferenceCard } from "@/components/settings/PreferenceCard";
import { APP_LOCALES, resolveLanguagePreference, type AppLanguagePreference } from "@/i18n/locales";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

export function LanguagePreferenceCard() {
  const appLanguage = usePreferencesStore((state) => state.appLanguage);
  const setAppLanguage = usePreferencesStore((state) => state.setAppLanguage);
  const activeLocale = resolveLanguagePreference(appLanguage);

  return (
    <PreferenceCard
      title={`Language`}
      description={`Changes menus and card printings when a translation is available.`}
      value={APP_LOCALES[activeLocale].label}
    >
      <select
        value={appLanguage}
        onChange={(event) => setAppLanguage(event.target.value as AppLanguagePreference)}
        aria-label={`Application language`}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm pointer-coarse:h-10 pointer-coarse:text-base"
      >
        <option value="system">{`Use system language`}</option>
        {Object.entries(APP_LOCALES).map(([locale, { label }]) => (
          <option key={locale} value={locale}>
            {label}
          </option>
        ))}
      </select>
      {appLanguage === "system" && (
        <p className="text-xs text-muted-foreground">
          Currently using {APP_LOCALES[activeLocale].label}
        </p>
      )}
    </PreferenceCard>
  );
}
