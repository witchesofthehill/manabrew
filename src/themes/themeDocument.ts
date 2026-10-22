import type { ThemeColors } from "@/themes/appTheme";
import MANABREW_THEME from "@/themes/default";
import {
  getGameThemeColorPaths,
  parseThemeColor,
  formatThemeColor,
  type GameThemeColorMap,
} from "@/themes/gameTheme";

export type ThemeMode = "light" | "dark";

export interface ThemeDocument {
  version: 2;
  base: "manabrew";
  name: string;
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
  if (document.version !== 1 && document.version !== 2) {
    throw new Error("Unsupported theme version. Expected version 1 or 2.");
  }
  if (document.version === 1 && document.presetId !== "default") {
    throw new Error(
      "This theme uses a removed base preset and cannot be imported. Only version 1 themes based on Manabrew are supported.",
    );
  }
  if (document.version === 2 && (document.base !== "manabrew" || "presetId" in document)) {
    throw new Error("Version 2 themes must use the Manabrew base without a preset selection.");
  }
  if (typeof document.name !== "string" || !document.name.trim() || document.name.length > 80) {
    throw new Error("Theme name must contain 1 to 80 characters.");
  }
  if (document.mode !== "light" && document.mode !== "dark") {
    throw new Error("Theme mode must be light or dark.");
  }
  const app = objectValue(document.appOverrides, "App overrides");
  const appKeys = Object.keys(MANABREW_THEME.dark) as (keyof ThemeColors)[];
  return {
    version: 2,
    base: "manabrew",
    name: document.name.trim(),
    mode: document.mode,
    appOverrides: {
      light: colorOverrides(app.light, appKeys, "light app"),
      dark: colorOverrides(app.dark, appKeys, "dark app"),
    },
    gameOverrides: colorOverrides(document.gameOverrides, getGameThemeColorPaths(), "game"),
  };
}
