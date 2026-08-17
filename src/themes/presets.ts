/**
 * Theme preset types, font-size defaults, and the preset registry.
 *
 * Extracted into its own module so both `index.ts` (barrel) and
 * `gameTheme.ts` (resolution logic) can import without a circular
 * dependency.
 */

import type { ThemeColors } from "./appTheme";
import type { GameThemeColorMap } from "./gameTheme";

/** Semantic font sizes used across the in-game panel surfaces. Values
 *  are raw pixel strings (e.g. `"13px"`, `"1rem"`) applied via
 *  `style={{ fontSize }}` or emitted as CSS variables (`--game-font-*`)
 *  in `useAppTheme`. Presets can override any entry to tune typography
 *  without touching component code. */
export interface GameFontSizes {
  /** Numeric count next to row badges (monarch crown, poison bottle, …). */
  badgeCount: string;
  /** Life total rendered inside the avatar's heart chip. */
  life: string;
  /** Per-color count rendered before each mana symbol in the mana pool. */
  manaCount: string;
  /** Count overlay drawn over library / graveyard / exile / command zone tiles. */
  zoneCount: string;
  /** Uppercase label under each zone tile ("Lib", "GY", "Exile", "Cmd"). */
  zoneLabel: string;
  /** Initials rendered inside the player avatar when no image is set. */
  avatarInitials: string;
}

/** Fallback values used when neither the active preset nor the default
 *  preset declares a token. */
export const DEFAULT_GAME_FONT_SIZES: GameFontSizes = {
  badgeCount: "13px",
  life: "14px",
  manaCount: "11px",
  zoneCount: "14px",
  zoneLabel: "10px",
  avatarInitials: "16px",
};

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  light: ThemeColors;
  dark: ThemeColors;
  gameColors: GameThemeColorMap;
  /** Optional — presets that don't provide this fall through to the
   *  default preset's entries via `resolveGameFontSizes`. */
  gameFontSizes?: Partial<GameFontSizes>;
}

import defaultPreset from "./default";
import rosePinePreset from "./rose-pine";
import nordPreset from "./nord";
import catppuccinPreset from "./catppuccin";
import solarizedPreset from "./solarized";
import draculaPreset from "./dracula";
import gruvboxPreset from "./gruvbox";
import tokyoNightPreset from "./tokyo-night";
import oneDarkPreset from "./one-dark";
import monokaiPreset from "./monokai";
import everforestPreset from "./everforest";
import kanagawaPreset from "./kanagawa";

export const THEME_PRESETS: ThemePreset[] = [
  defaultPreset,
  nordPreset,
  rosePinePreset,
  catppuccinPreset,
  draculaPreset,
  tokyoNightPreset,
  oneDarkPreset,
  gruvboxPreset,
  monokaiPreset,
  solarizedPreset,
  everforestPreset,
  kanagawaPreset,
];
