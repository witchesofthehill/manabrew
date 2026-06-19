import type { ActivatableAbilityInfo } from "@/types/manabrew";

export interface ManaAbilityActionInfo extends ActivatableAbilityInfo {
  actionId?: string;
}

export interface ExpandedManaAbilityInfo extends ManaAbilityActionInfo {
  displayManaLetters: string[];
  colorChoice?: string;
}

export function extractManaLetters(desc: string | undefined): string[] {
  if (!desc) return [];
  const matches = desc.matchAll(/\{([WUBRGC])\}/g);
  return Array.from(matches, (m) => m[1]);
}

export const ANY_COLOR_LETTERS = ["W", "U", "B", "R", "G"];

const MANA_TOKEN_TO_LETTER: Record<string, string> = {
  WHITE: "W",
  W: "W",
  BLUE: "U",
  U: "U",
  BLACK: "B",
  B: "B",
  RED: "R",
  R: "R",
  GREEN: "G",
  G: "G",
  COLORLESS: "C",
  C: "C",
};

function producedManaTokens(producedMana: string | undefined): string[] {
  if (!producedMana) return [];
  return producedMana
    .replace(/[{}]/g, " ")
    .split(/[\s,/]+/)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
}

function uniqueLetters(letters: string[]): string[] {
  return [...new Set(letters)];
}

function displayDescription(letters: string[]): string {
  return letters.length === 0
    ? "Add mana"
    : `Add ${letters.map((letter) => `{${letter}}`).join("")}`;
}

function displayFromProducedMana(ab: ManaAbilityActionInfo): ExpandedManaAbilityInfo | null {
  const tokens = producedManaTokens(ab.producedMana);
  if (tokens.length === 0) return null;

  const isCombo = tokens.includes("COMBO");
  const manaTokens = tokens.filter((token) => token !== "COMBO");
  const isAny = manaTokens.includes("ANY");
  const tokenLetters = manaTokens
    .map((token) => MANA_TOKEN_TO_LETTER[token])
    .filter((letter): letter is string => letter != null);
  const letters = isAny ? ANY_COLOR_LETTERS : isCombo ? uniqueLetters(tokenLetters) : tokenLetters;

  if (letters.length === 0) return null;

  return {
    ...ab,
    description: displayDescription(letters),
    displayManaLetters: letters,
    colorChoice: ab.color,
  };
}

function displayFromDescription(ab: ManaAbilityActionInfo): ExpandedManaAbilityInfo {
  return {
    ...ab,
    displayManaLetters: extractManaLetters(ab.description),
    colorChoice: ab.color,
  };
}

export const getDisplayedManaAbilities = (
  cardId: string,
  options: ManaAbilityActionInfo[],
): ExpandedManaAbilityInfo[] => {
  const cardAbs = options.filter((a) => a.cardId === cardId);
  if (cardAbs.length === 0) return [];

  return cardAbs.map((ab) => displayFromProducedMana(ab) ?? displayFromDescription(ab));
};
