import { msg } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { PreferenceCard } from "@/components/settings/PreferenceCard";
import { APP_LOCALES, resolveLanguagePreference, type AppLanguagePreference } from "@/i18n/locales";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

export function LanguagePreferenceCard() {
  const { _ } = useLingui();
  const appLanguage = usePreferencesStore((state) => state.appLanguage);
  const setAppLanguage = usePreferencesStore((state) => state.setAppLanguage);
  const activeLocale = resolveLanguagePreference(appLanguage);

  return (
    <PreferenceCard
      title={_(msg`Language`)}
      description={_(msg`Changes menus and card printings when a translation is available.`)}
      value={APP_LOCALES[activeLocale].label}
    >
      <select
        value={appLanguage}
        onChange={(event) => setAppLanguage(event.target.value as AppLanguagePreference)}
        aria-label={_(msg`Application language`)}
        className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm pointer-coarse:h-10 pointer-coarse:text-base"
      >
        <option value="system">{_(msg`Use system language`)}</option>
        {Object.entries(APP_LOCALES).map(([locale, { label }]) => (
          <option key={locale} value={locale}>
            {label}
          </option>
        ))}
      </select>
      {appLanguage === "system" && (
        <p className="text-xs text-muted-foreground">
          <Trans>Currently using {APP_LOCALES[activeLocale].label}</Trans>
        </p>
      )}
    </PreferenceCard>
  );
}
