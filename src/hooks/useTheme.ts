import { useLayoutEffect, useSyncExternalStore } from "react";
import { useTheme as useNextTheme } from "next-themes";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { MANABREW_THEME } from "@/themes";
import type { ThemeColors, GameFontSizes } from "@/themes";
import {
  filterGameThemeColorOverrides,
  getGameThemeColorPaths,
  resolveGameThemeColors,
  flattenGameThemeToCssVars,
  type GameThemeColors,
  type GameThemeColorMap,
} from "@/themes/gameTheme";
import type { ThemeDocument, ThemeMode } from "@/themes/themeDocument";
export type { GameThemeColors } from "@/themes/gameTheme";
export type { GameFontSizes } from "@/themes";

export interface GameTheme extends GameThemeColors {
  fontSizes: GameFontSizes;
}

export interface Theme {
  appTheme: ThemeColors;
  gameTheme: GameTheme;
}

let savedMode: ThemeMode = "dark";
let previewDocument: ThemeDocument | null = null;
const listeners = new Set<() => void>();

export function getThemeDocument(mode: ThemeMode = savedMode): ThemeDocument {
  const state = usePreferencesStore.getState();
  return {
    version: 2,
    base: "manabrew",
    name: state.personalThemeName ?? MANABREW_THEME.name,
    mode,
    appOverrides: state.appThemeColorOverrides,
    gameOverrides: filterGameThemeColorOverrides(state.gameThemeColorOverrides),
  };
}

function defaultGameColors(mode: ThemeMode, appTheme: ThemeColors): GameThemeColorMap {
  if (mode === "dark") return MANABREW_THEME.gameColors;
  return {
    ...MANABREW_THEME.gameColors,
    "phaseStrip.background": appTheme.card,
    "cardPlaceholder.fill": appTheme.muted,
    "cardPlaceholder.stroke": appTheme.border,
  };
}

export function resolveThemeDocument(document: ThemeDocument): Theme {
  const appTheme = { ...MANABREW_THEME[document.mode], ...document.appOverrides[document.mode] };
  return {
    appTheme,
    gameTheme: {
      ...resolveGameThemeColors({
        ...defaultGameColors(document.mode, appTheme),
        ...document.gameOverrides,
      }),
      fontSizes: MANABREW_THEME.gameFontSizes,
    },
  };
}

let activeDocument = getThemeDocument();
let cachedTheme = resolveThemeDocument(activeDocument);
let gameCssVars = flattenGameThemeToCssVars(cachedTheme.gameTheme);

function refreshTheme(force = false): void {
  const next = previewDocument ?? getThemeDocument();
  if (
    !force &&
    next.mode === activeDocument.mode &&
    next.appOverrides === activeDocument.appOverrides &&
    next.gameOverrides === activeDocument.gameOverrides
  )
    return;
  activeDocument = next;
  cachedTheme = resolveThemeDocument(next);
  gameCssVars = flattenGameThemeToCssVars(cachedTheme.gameTheme);
  for (const listener of listeners) listener();
}

const unsubscribePreferences = usePreferencesStore.subscribe((state, previous) => {
  if (
    state.appThemeColorOverrides !== previous.appThemeColorOverrides ||
    state.gameThemeColorOverrides !== previous.gameThemeColorOverrides
  )
    refreshTheme();
});
if (import.meta.hot) import.meta.hot.dispose(unsubscribePreferences);

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTheme(): Theme {
  return cachedTheme;
}

export function setThemePreview(document: ThemeDocument | null): void {
  const modeChanged = previewDocument?.mode !== document?.mode;
  previewDocument = document;
  refreshTheme(modeChanged);
}

export function saveThemeDocument(document: ThemeDocument): void {
  savedMode = document.mode;
  usePreferencesStore.setState({
    personalThemeName: document.name,
    appThemeColorOverrides: document.appOverrides,
    gameThemeColorOverrides: document.gameOverrides,
  });
}

function getPreviewMode(): ThemeMode | undefined {
  return previewDocument?.mode;
}

export function useThemePreviewMode(): ThemeMode | undefined {
  return useSyncExternalStore(subscribeTheme, getPreviewMode, getPreviewMode);
}

export function getDefaultGameThemeColorMap(mode: ThemeMode = savedMode): Record<string, string> {
  const document = getThemeDocument(mode);
  const defaults = defaultGameColors(mode, {
    ...MANABREW_THEME[mode],
    ...document.appOverrides[mode],
  });
  return Object.fromEntries(getGameThemeColorPaths().map((key) => [key, defaults[key]]));
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getTheme, getTheme);
}

export function useApplyTheme(): void {
  const { resolvedTheme } = useNextTheme();
  const theme = useTheme();
  useLayoutEffect(() => {
    const mode = resolvedTheme === "light" ? "light" : "dark";
    if (savedMode === mode) return;
    savedMode = mode;
    refreshTheme();
  }, [resolvedTheme]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(theme.appTheme))
      root.style.setProperty(`--${key}`, value);
    for (const [key, value] of Object.entries(gameCssVars)) root.style.setProperty(key, value);
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content =
      theme.appTheme.background;
  }, [theme]);
}
