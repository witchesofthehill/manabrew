/**
 * Theme barrel — single import point for the full theme system.
 *
 *   import { ThemeColors, GameThemeColors, THEME_PRESETS, ... } from "@/themes";
 *
 * Implementation is split across three files:
 *   - `appTheme.ts`  — app-level (Radix / shadcn) colour interface
 *   - `gameTheme.ts` — game-surface colour interface, resolution logic, utilities
 *   - `presets.ts`    — ThemePreset type, font sizes, and the preset registry
 */

export type { ThemeColors } from "./appTheme";

export type {
  GameThemeColors,
  GameThemeColorKey,
  GameThemeColorMap,
  ManaLetter,
} from "./gameTheme";
export {
  MANA_LETTERS,
  resolveGameThemeColors,
  flattenGameThemeToCssVars,
  resolveGameFontSizes,
  getGameThemeColorPaths,
  toPickerHexColor,
  hexToRgb,
  withAlpha,
} from "./gameTheme";

export type { GameFontSizes, ThemePreset } from "./presets";
export { DEFAULT_GAME_FONT_SIZES, THEME_PRESETS } from "./presets";
