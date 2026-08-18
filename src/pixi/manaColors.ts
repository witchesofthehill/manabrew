import type { Theme } from "@/hooks/useTheme";
import { hexToNum } from "./colorUtils";
import { MANA_LETTERS, type ManaLetter } from "@/themes/gameTheme";

export type { ManaLetter } from "@/themes/gameTheme";

const MANA_SET = new Set<ManaLetter>(MANA_LETTERS);

export const isManaLetter = (value: string | undefined): value is ManaLetter =>
  value != null && MANA_SET.has(value as ManaLetter);

export const manaColorFor = (letter: string | undefined, theme: Theme, fallback: number): number =>
  isManaLetter(letter) ? hexToNum(theme.gameTheme.mana[letter]) : fallback;
