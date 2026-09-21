import type { GameThemeColorKey, GameThemeColors } from "@/themes";

export function getGameColor(theme: GameThemeColors, key: GameThemeColorKey): string {
  return key
    .split(".")
    .reduce<unknown>(
      (value, segment) => (value as Record<string, unknown>)[segment],
      theme,
    ) as string;
}
