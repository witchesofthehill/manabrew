import preset from "../../src/themes/default";
import type { ThemeColors } from "../../src/themes/appTheme";

export default preset;

export function cssVars(colors: ThemeColors, prefix = "--mb-"): string {
  return Object.entries(colors)
    .map(([key, value]) => `${prefix}${key}: ${value};`)
    .join(" ");
}
