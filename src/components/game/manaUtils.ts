import type { ActivatableAbilityInfo } from "@/types/manabrew";

export interface ExpandedManaAbilityInfo extends ActivatableAbilityInfo {
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

function repeatLetters(letters: string[], amount: number): string[] {
  if (amount <= 1) return letters;
  return Array.from({ length: amount }, () => letters).flat();
}

function displayDescription(letters: string[]): string {
  return letters.length === 0
    ? "Add mana"
    : `Add ${letters.map((letter) => `{${letter}}`).join("")}`;
}

function expandFromProducedMana(ab: ActivatableAbilityInfo): ExpandedManaAbilityInfo[] | null {
  const tokens = producedManaTokens(ab.producedMana);
  if (tokens.length === 0) return null;

  const isCombo = tokens.includes("COMBO");
  const manaTokens = tokens.filter((token) => token !== "COMBO");
  const isAny = manaTokens.includes("ANY");
  const amount = Math.max(1, ab.producedManaAmount ?? 1);
  const tokenLetters = manaTokens
    .map((token) => MANA_TOKEN_TO_LETTER[token])
    .filter((letter): letter is string => letter != null);
  const letters = isAny ? ANY_COLOR_LETTERS : isCombo ? uniqueLetters(tokenLetters) : tokenLetters;

  if (letters.length === 0) return null;

  if (isAny || isCombo) {
    if (isCombo && amount > 1) {
      return [
        {
          ...ab,
          description: displayDescription(letters),
          displayManaLetters: letters,
        },
      ];
    }
    return letters.map((letter) => ({
      ...ab,
      description: displayDescription([letter]),
      displayManaLetters: [letter],
      colorChoice: letter,
    }));
  }

  const displayManaLetters = repeatLetters(tokenLetters, amount);
  return [
    {
      ...ab,
      description: displayDescription(displayManaLetters),
      displayManaLetters,
    },
  ];
}

function expandFromDescription(ab: ActivatableAbilityInfo): ExpandedManaAbilityInfo[] {
  const letters = extractManaLetters(ab.description);
  if (letters.length === 0) {
    return [{ ...ab, displayManaLetters: [] }];
  }
  const unique = uniqueLetters(letters);
  if (unique.length > 1) {
    return unique.map((letter) => ({
      ...ab,
      description: displayDescription([letter]),
      displayManaLetters: [letter],
      colorChoice: letter,
    }));
  }
  return [{ ...ab, displayManaLetters: letters }];
}

export const getExpandedManaAbilities = (
  cardId: string,
  options: ActivatableAbilityInfo[],
): ExpandedManaAbilityInfo[] => {
  const cardAbs = options.filter((a) => a.cardId === cardId);
  if (cardAbs.length === 0) return [];

  return cardAbs.flatMap((ab) => expandFromProducedMana(ab) ?? expandFromDescription(ab));
};
