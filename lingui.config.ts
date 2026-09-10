import { defineConfig } from "@lingui/cli";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "es"],
  fallbackLocales: { default: "en" },
  catalogs: [
    {
      path: "<rootDir>/src/i18n/locales/{locale}/messages",
      include: ["<rootDir>/src"],
      exclude: ["<rootDir>/src/**/*.d.ts"],
    },
  ],
});
