import type { ActivatableAbilityInfo } from "@/types/manabrew";

/** Extract all mana letters from an ability description like "Add {G}." or "Add {W} or {U}." */
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

function extractProducedManaTokens(cost: string | undefined): string[] {
  if (!cost) return [];
  return cost
    .replace(/[{}]/g, " ")
    .split(/[\s,/]+/)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
}

function extractProducedManaLetters(cost: string | undefined): string[] {
  return extractProducedManaTokens(cost)
    .map((token) => MANA_TOKEN_TO_LETTER[token])
    .filter((letter) => letter != null);
}

function hasAnyColorText(text: string): boolean {
  return (
    text.includes("any color") ||
    text.includes("any one color") ||
    text.includes("mana of any color")
  );
}

export const getExpandedManaAbilities = (
  cardId: string,
  options: ActivatableAbilityInfo[],
): ActivatableAbilityInfo[] => {
  const cardAbs = options.filter((a) => a.cardId === cardId);
  if (cardAbs.length === 0) return [];

  const expanded: ActivatableAbilityInfo[] = [];

  for (const ab of cardAbs) {
    const letters = extractManaLetters(ab.description);
    const desc = ab.description.toLowerCase();
    const producedTokens = extractProducedManaTokens(ab.cost);
    const cost = producedTokens.join(" ").toLowerCase();
    const producedLetters = extractProducedManaLetters(ab.cost);
    const isAnyColor =
      hasAnyColorText(desc) || hasAnyColorText(cost) || producedTokens.includes("ANY");

    if (letters.length > 1) {
      [...new Set(letters)].forEach((letter) => {
        expanded.push({
          ...ab,
          description: `Add {${letter}}`,
        });
      });
    } else if (letters.length === 1) {
      expanded.push(ab);
    } else if (isAnyColor) {
      ANY_COLOR_LETTERS.forEach((letter) => {
        expanded.push({
          ...ab,
          description: `Add {${letter}}`,
        });
      });
    } else if (producedLetters.length > 0) {
      const uniqueProducedLetters = [...new Set(producedLetters)];
      if (uniqueProducedLetters.length === 1) {
        expanded.push({
          ...ab,
          description: `Add {${uniqueProducedLetters[0]}}`,
        });
      } else {
        uniqueProducedLetters.forEach((letter) => {
          expanded.push({
            ...ab,
            description: `Add {${letter}}`,
          });
        });
      }
    } else {
      expanded.push(ab);
    }
  }

  return expanded;
};
