import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { THEME_PRESETS, DEFAULT_GAME_FONT_SIZES, type GameFontSizes } from "./presets";

export type ManaLetter = "W" | "U" | "B" | "R" | "G" | "C";

export const MANA_LETTERS: readonly ManaLetter[] = ["W", "U", "B", "R", "G", "C"] as const;

export const MANA_BG_CLASS: Record<ManaLetter, string> = {
  W: "bg-mana-w",
  U: "bg-mana-u",
  B: "bg-mana-b",
  R: "bg-mana-r",
  G: "bg-mana-g",
  C: "bg-mana-c",
};

export interface GameThemeColors {
  activeAction: {
    priority: string;
    active: string;
  };
  promptAction: {
    passAction: string;
    attackAction: string;
    defenseAction: string;
    cancel: string;
  };
  arrow: {
    attack: string;
    block: string;
    hostileTarget: string;
    friendlyTarget: string;
  };
  pointer: {
    hostile: string;
    friendly: string;
  };
  mana: Record<ManaLetter, string>;
  cardStatus: {
    exerted: string;
    morph: string;
    bestow: string;
    token: string;
    transformed: string;
    plotted: string;
    madness: string;
    warped: string;
    copy: string;
  };
  textOnTinted: string;
  textMuted: string;
  textGhost: string;
  canvas: {
    background: string;
    shadow: string;
    neutral: string;
  };
  cardPlaceholder: {
    fill: string;
    stroke: string;
  };
  pt: {
    neutral: string;
    lethal: string;
    buffed: string;
    debuffed: string;
  };
  success: string;
  poison: string;
  life: string;
  counter: {
    default: string;
    p1p1: string;
    m1m1: string;
    loyalty: string;
    charge: string;
    quest: string;
    study: string;
    lore: string;
    age: string;
    time: string;
    fade: string;
    level: string;
    storage: string;
    mining: string;
    brick: string;
    depletion: string;
    page: string;
    shield: string;
  };
  cardRing: string;
  playerColors: {
    self: string;
    opponent1: string;
    opponent2: string;
    opponent3: string;
  };
  badges: {
    monarch: string;
    initiative: string;
    poison: string;
    energy: string;
    commanderDamage: string;
    hand: string;
    radiation: string;
    cityBlessing: string;
    ring: string;
    speed: string;
  };
  legality: {
    legal: string;
    banned: string;
    restricted: string;
  };
  formatBadge: {
    blue: string;
    amber: string;
    emerald: string;
    rose: string;
    slate: string;
    zinc: string;
    purple: string;
    teal: string;
    orange: string;
    sky: string;
    indigo: string;
  };
  rarity: {
    common: string;
    uncommon: string;
    rare: string;
    mythic: string;
    special: string;
    land: string;
  };
}

type FlatPaths<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string
    ? P extends ""
      ? K
      : `${P}.${K}`
    : FlatPaths<T[K], P extends "" ? K : `${P}.${K}`>;
}[keyof T & string];

export type GameThemeColorKey = FlatPaths<GameThemeColors>;

export type GameThemeColorMap = Record<GameThemeColorKey, string>;

function flatToGameTheme(flat: GameThemeColorMap): GameThemeColors {
  const result: Record<string, unknown> = {};
  for (const [path, value] of Object.entries(flat)) {
    const segments = path.split(".");
    let cursor: Record<string, unknown> = result;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      cursor[seg] ??= {};
      cursor = cursor[seg] as Record<string, unknown>;
    }
    cursor[segments[segments.length - 1]!] = value;
  }
  return result as unknown as GameThemeColors;
}

function cleanFlatMap(raw: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(raw)
      .filter(([, v]) => typeof v === "string" && v.trim())
      .map(([k, v]) => [k, v.trim()]),
  );
}

const DEFAULT_PRESET_GAME_COLORS: GameThemeColorMap = (() => {
  const defaultPreset = THEME_PRESETS.find((p) => p.id === "default");
  if (!defaultPreset) return {} as GameThemeColorMap;
  return cleanFlatMap(defaultPreset.gameColors) as GameThemeColorMap;
})();

export function getGameThemeColorPaths(): GameThemeColorKey[] {
  return Object.keys(DEFAULT_PRESET_GAME_COLORS) as GameThemeColorKey[];
}

export function resolveGameThemeColors(
  overrides: Partial<GameThemeColorMap> = {},
  presetId?: string,
): GameThemeColors {
  const activePresetId = presetId ?? usePreferencesStore.getState().appThemePreset;
  const preset = THEME_PRESETS.find((p) => p.id === activePresetId) || THEME_PRESETS[0]!;

  const merged = {
    ...DEFAULT_PRESET_GAME_COLORS,
    ...cleanFlatMap(preset.gameColors),
    ...cleanFlatMap(overrides as Record<string, string>),
  } as GameThemeColorMap;

  return flatToGameTheme(merged);
}

export function flattenGameThemeToCssVars(theme: GameThemeColors): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (value: unknown, prefix: string): void => {
    if (typeof value === "string") {
      if (value.trim()) out[`--${prefix}`] = value;
      return;
    }
    if (value == null || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const segment = camelToKebab(key).toLowerCase();
      const nextPrefix = prefix ? `${prefix}-${segment}` : segment;
      walk(nested, nextPrefix);
    }
  };
  walk(theme, "");
  return out;
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (char, index) =>
    index === 0 ? char.toLowerCase() : `-${char.toLowerCase()}`,
  );
}

export function resolveGameFontSizes(presetId?: string): GameFontSizes {
  const activePresetId = presetId ?? usePreferencesStore.getState().appThemePreset;
  const active = THEME_PRESETS.find((p) => p.id === activePresetId);
  const fallback = THEME_PRESETS.find((p) => p.id === "default");
  return {
    ...DEFAULT_GAME_FONT_SIZES,
    ...(fallback?.gameFontSizes ?? {}),
    ...(active?.gameFontSizes ?? {}),
  };
}

function normalizeHexColor(hex: string): string {
  const value = hex.trim().replace("#", "");
  if (/^[\da-fA-F]{3}$/.test(value)) {
    return `#${value
      .split("")
      .map((char) => `${char}${char}`)
      .join("")
      .toLowerCase()}`;
  }
  if (/^[\da-fA-F]{6}$/.test(value)) {
    return `#${value.toLowerCase()}`;
  }
  return "#000000";
}

export function toPickerHexColor(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) return normalizeHexColor(trimmed);
  const rgbaMatch = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0|1|0?\.\d+))?\s*\)$/i,
  );
  if (rgbaMatch) {
    const r = Math.min(255, Number.parseInt(rgbaMatch[1]!, 10));
    const g = Math.min(255, Number.parseInt(rgbaMatch[2]!, 10));
    const b = Math.min(255, Number.parseInt(rgbaMatch[3]!, 10));
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  }
  return "#000000";
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(hex);
  const raw = normalized.slice(1);
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function readableTextColor(background: string, dark: string, light: string): string {
  return relativeLuminance(background) > 0.6 ? dark : light;
}

export function darken(hex: string, factor: number): string {
  const { r, g, b } = hexToRgb(hex);
  const k = Math.max(0, Math.min(1, 1 - factor));
  const to = (n: number) =>
    Math.round(n * k)
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

const FRAME_TINT_DARKEN = 0.3;
const FRAME_TINT_MAX_LUMINANCE = 0.45;
export const FRAME_TINT_COLORLESS_MAX_LUMINANCE = 0.54;

export function frameTint(hex: string, maxLuminance = FRAME_TINT_MAX_LUMINANCE): string {
  const base = darken(hex, FRAME_TINT_DARKEN);
  const lum = relativeLuminance(base);
  return lum <= maxLuminance ? base : darken(base, 1 - maxLuminance / lum);
}
