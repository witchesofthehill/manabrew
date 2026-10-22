import { createRoot } from "react-dom/client";
import "@fontsource/alegreya-sans/700.css";
import "@fontsource-variable/source-sans-3";
import "@fontsource-variable/source-sans-3/wght-italic.css";
import "./index.css";
import App from "./App.tsx";
import { registerConsoleHooks } from "./lib/consoleHooks";
import { initAndroidSafeArea } from "./platform/androidSafeArea";
import { initializeLocalization } from "./i18n/runtime";
import { DISPLAY_FONT_FAMILY, UI_FONT_FAMILY } from "@/themes/typography";

async function start(): Promise<void> {
  initAndroidSafeArea();
  registerConsoleHooks();
  const fontSample = "Manabrew Ā Ω ᾀ Ж Ѣ ế";
  await Promise.all([
    initializeLocalization(),
    Promise.allSettled([
      document.fonts.load(`400 16px ${UI_FONT_FAMILY}`, fontSample),
      document.fonts.load(`italic 400 16px ${UI_FONT_FAMILY}`, fontSample),
      document.fonts.load(`700 32px ${DISPLAY_FONT_FAMILY}`, fontSample),
    ]),
  ]);

  createRoot(document.getElementById("root")!).render(<App />);
}

void start();
