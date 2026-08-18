/**
 * Theme preset types, font-size defaults, and the preset registry.
 *
 * Extracted into its own module so both `index.ts` (barrel) and
 * `gameTheme.ts` (resolution logic) can import without a circular
 * dependency.
 */

import type { ThemeColors } from "./appTheme";
import type { GameThemeColorMap } from "./gameTheme";

export interface GameFontSizes {
  badgeCount: string;
  life: string;
  manaCount: string;
  zoneCount: string;
  zoneLabel: string;
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
