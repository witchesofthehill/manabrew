import { useLayoutEffect, useSyncExternalStore } from "react";
import { useTheme as useNextTheme } from "next-themes";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { THEME_PRESETS } from "@/themes";
import type { ThemeColors, GameFontSizes } from "@/themes";
import {
  filterGameThemeColorOverrides,
  resolveGameThemeColors,
  flattenGameThemeToCssVars,
  resolveGameFontSizes,
  type GameThemeColors,
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
  const preset =
    THEME_PRESETS.find((candidate) => candidate.id === state.appThemePreset) ?? THEME_PRESETS[0]!;
  return {
    version: 1,
    name: state.personalThemeName ?? preset.name,
    presetId: preset.id,
    mode,
    appOverrides: state.appThemeColorOverrides,
    gameOverrides: filterGameThemeColorOverrides(state.gameThemeColorOverrides),
  };
}

export function resolveThemeDocument(document: ThemeDocument): Theme {
  const preset =
    THEME_PRESETS.find((candidate) => candidate.id === document.presetId) ?? THEME_PRESETS[0]!;
  return {
    appTheme: { ...preset[document.mode], ...document.appOverrides[document.mode] },
    gameTheme: {
      ...resolveGameThemeColors(document.gameOverrides, preset.id),
      fontSizes: resolveGameFontSizes(preset.id),
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
    next.presetId === activeDocument.presetId &&
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
    state.appThemePreset !== previous.appThemePreset ||
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
    appThemePreset: document.presetId,
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

export function getDefaultGameThemeColorMap(): Record<string, string> {
  const preset =
    THEME_PRESETS.find(
      (candidate) => candidate.id === usePreferencesStore.getState().appThemePreset,
    ) ?? THEME_PRESETS[0]!;
  return { ...THEME_PRESETS[0]!.gameColors, ...preset.gameColors };
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
  }, [theme]);
}
