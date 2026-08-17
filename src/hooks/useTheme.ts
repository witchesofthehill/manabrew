import { useEffect, useMemo } from "react";
import { useTheme as useNextTheme } from "next-themes";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { THEME_PRESETS } from "@/themes";
import type { ThemeColors } from "@/themes";
import {
  resolveGameThemeColors,
  flattenGameThemeToCssVars,
  resolveGameFontSizes,
  getGameThemeColorPaths,
  type GameThemeColors,
} from "@/themes/gameTheme";
import type { GameFontSizes } from "@/themes";
export type { GameThemeColors } from "@/themes/gameTheme";
export type { GameFontSizes } from "@/themes";

/** Resolved game theme — colours plus font sizes. */
export interface GameTheme extends GameThemeColors {
  fontSizes: GameFontSizes;
}

/** The single resolved theme object used across the entire app. */
export interface Theme {
  appTheme: ThemeColors;
  gameTheme: GameTheme;
}

// Imperative accessor — cached, kept in sync via a preferences subscription.
// Used by Pixi and other non-React code that cannot call hooks.

/** Internal shape that also carries the CSS variable map for :root
 *  injection. Consumers see only `Theme`; `gameCssVars` stays private. */
interface ThemeInternal extends Theme {
  gameCssVars: Record<string, string>;
}

function buildTheme(): ThemeInternal {
  const { appThemePreset, gameThemeColorOverrides } = usePreferencesStore.getState();
  const preset = THEME_PRESETS.find((p) => p.id === appThemePreset) ?? THEME_PRESETS[0]!;
  const appTheme = preset.dark;
  const gameColors = resolveGameThemeColors(gameThemeColorOverrides, appThemePreset);
  const fontSizes = resolveGameFontSizes(appThemePreset);
  const gameCssVars = flattenGameThemeToCssVars(gameColors);
  return { appTheme, gameTheme: { ...gameColors, fontSizes }, gameCssVars };
}

let cachedTheme: ThemeInternal = buildTheme();
let prevPreset = usePreferencesStore.getState().appThemePreset;
let prevGameOverrides = usePreferencesStore.getState().gameThemeColorOverrides;

usePreferencesStore.subscribe(() => {
  const { appThemePreset, gameThemeColorOverrides } = usePreferencesStore.getState();
  if (appThemePreset !== prevPreset || gameThemeColorOverrides !== prevGameOverrides) {
    prevPreset = appThemePreset;
    prevGameOverrides = gameThemeColorOverrides;
    cachedTheme = buildTheme();
  }
});

/** Non-reactive accessor for imperative / Pixi code. */
export function getTheme(): Theme {
  return cachedTheme;
}
/** Return a flat map of every canonical game-theme path to its resolved
 *  colour for the active preset.  Uses the schema-driven path list from
 *  `getGameThemeColorPaths` so the Settings picker always shows exactly
 *  the keys that `GameThemeColors` expects — no legacy aliases, no
 *  missing tokens. */
export function getDefaultGameThemeColorMap(): Record<string, string> {
  const presetId = usePreferencesStore.getState().appThemePreset;
  const resolved = resolveGameThemeColors({}, presetId);
  const paths = getGameThemeColorPaths();
  const out: Record<string, string> = {};
  for (const path of paths) {
    const segments = path.split(".");
    let cursor: unknown = resolved;
    for (const seg of segments) {
      if (cursor != null && typeof cursor === "object") {
        cursor = (cursor as Record<string, unknown>)[seg];
      } else {
        cursor = undefined;
        break;
      }
    }
    if (typeof cursor === "string" && cursor.trim()) {
      out[path] = cursor;
    }
  }
  return out;
}
export function useTheme(): Theme {
  const presetId = usePreferencesStore((s) => s.appThemePreset);
  const appOverrides = usePreferencesStore((s) => s.appThemeColorOverrides);
  const gameOverrides = usePreferencesStore((s) => s.gameThemeColorOverrides);
  const { resolvedTheme } = useNextTheme();

  const theme = useMemo((): ThemeInternal => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId) ?? THEME_PRESETS[0]!;
    const mode = resolvedTheme === "dark" ? "dark" : "light";
    const appTheme = preset[mode];
    const gameColors = resolveGameThemeColors(gameOverrides, presetId);
    const fontSizes = resolveGameFontSizes(presetId);
    const gameCssVars = flattenGameThemeToCssVars(gameColors);
    return { appTheme, gameTheme: { ...gameColors, fontSizes }, gameCssVars };
  }, [presetId, gameOverrides, resolvedTheme]);

  // Write CSS variables onto :root (idempotent — no cleanup needed since the
  // full set of keys is always written on every change).
  useEffect(() => {
    const preset = THEME_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    const mode = resolvedTheme === "dark" ? "dark" : "light";
    const colors: ThemeColors = preset[mode];
    const root = document.documentElement;

    for (const [key, value] of Object.entries(colors)) {
      root.style.setProperty(`--${key}`, value);
    }
    for (const [key, value] of Object.entries(appOverrides)) {
      if (value) root.style.setProperty(`--${key}`, value);
    }
    for (const [cssKey, value] of Object.entries(theme.gameCssVars)) {
      root.style.setProperty(cssKey, value);
    }
  }, [presetId, resolvedTheme, appOverrides, theme.gameCssVars]);

  return theme;
}
