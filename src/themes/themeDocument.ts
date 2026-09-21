import type { ThemeColors } from "@/themes/appTheme";
import { THEME_PRESETS } from "@/themes/presets";
import {
  getGameThemeColorPaths,
  parseThemeColor,
  formatThemeColor,
  type GameThemeColorMap,
} from "@/themes/gameTheme";

export type ThemeMode = "light" | "dark";

export interface ThemeDocument {
  version: 1;
  name: string;
  presetId: string;
  mode: ThemeMode;
  appOverrides: Record<ThemeMode, Partial<ThemeColors>>;
  gameOverrides: Partial<GameThemeColorMap>;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function colorOverrides<K extends string>(
  value: unknown,
  keys: readonly K[],
  label: string,
): Partial<Record<K, string>> {
  const source = objectValue(value, label);
  const allowed = new Set<string>(keys);
  const result: Partial<Record<K, string>> = {};
  for (const [key, color] of Object.entries(source)) {
    if (!allowed.has(key)) throw new Error(`Unknown ${label} color: ${key}.`);
    const parsed = typeof color === "string" ? parseThemeColor(color) : null;
    if (!parsed) throw new Error(`Invalid color for ${label}.${key}. Use hex or rgb/rgba.`);
    result[key as K] = formatThemeColor(parsed.hex, parsed.alpha);
  }
  return result;
}

export function parseThemeDocument(input: unknown): ThemeDocument {
  const document = objectValue(input, "Theme");
  if (document.version !== 1) throw new Error("Unsupported theme version. Expected version 1.");
  if (typeof document.name !== "string" || !document.name.trim() || document.name.length > 80) {
    throw new Error("Theme name must contain 1 to 80 characters.");
  }
  const preset = THEME_PRESETS.find((candidate) => candidate.id === document.presetId);
  if (!preset) throw new Error("Unknown base preset.");
  if (document.mode !== "light" && document.mode !== "dark") {
    throw new Error("Theme mode must be light or dark.");
  }
  const app = objectValue(document.appOverrides, "App overrides");
  const appKeys = Object.keys(preset.dark) as (keyof ThemeColors)[];
  return {
    version: 1,
    name: document.name.trim(),
    presetId: preset.id,
    mode: document.mode,
    appOverrides: {
      light: colorOverrides(app.light, appKeys, "light app"),
      dark: colorOverrides(app.dark, appKeys, "dark app"),
    },
    gameOverrides: colorOverrides(document.gameOverrides, getGameThemeColorPaths(), "game"),
  };
}
