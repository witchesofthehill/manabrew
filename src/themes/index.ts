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
