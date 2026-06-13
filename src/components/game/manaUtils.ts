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

interface ParsedProducedMana {
  isCombo: boolean;
  hasAny: boolean;
  letters: string[];
}

function uniqueLetters(letters: string[]): string[] {
  return [...new Set(letters)];
}

function extractProducedManaTokens(producedMana: string | undefined): string[] {
  if (!producedMana) return [];
  return producedMana
    .replace(/[{}]/g, " ")
    .split(/[\s,/]+/)
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
}

function parseProducedMana(producedMana: string | undefined): ParsedProducedMana | null {
  const tokens = extractProducedManaTokens(producedMana);
  if (tokens.length === 0) return null;
  const isCombo = tokens[0] === "COMBO";
  const body = isCombo ? tokens.slice(1) : tokens;
  const hasAny = body.includes("ANY");
  const letters = uniqueLetters(
    body.map((token) => MANA_TOKEN_TO_LETTER[token]).filter((letter) => letter != null),
  );
  return { isCombo, hasAny, letters };
}

function formatFixedMana(letters: string[]): string {
  return `Add ${letters.map((letter) => `{${letter}}`).join("")}`;
}

function formatChoiceMana(letter: string): string {
  return `Add {${letter}}`;
}

function isChoiceDescription(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes(" or ") ||
    lower.includes(", or ") ||
    lower.includes("choose") ||
    hasAnyColorText(lower)
  );
}

function expandedFromProducedMana(ab: ActivatableAbilityInfo): ActivatableAbilityInfo[] | null {
  const parsed = parseProducedMana(ab.producedMana);
  if (!parsed) return null;

  if (parsed.hasAny) {
    if (parsed.isCombo) {
      return [{ ...ab, description: formatFixedMana(ANY_COLOR_LETTERS) }];
    }
    return ANY_COLOR_LETTERS.map((letter) => ({
      ...ab,
      description: formatChoiceMana(letter),
    }));
  }

  if (parsed.letters.length === 0) return null;

  if (parsed.isCombo && parsed.letters.length > 1) {
    return parsed.letters.map((letter) => ({
      ...ab,
      description: formatChoiceMana(letter),
    }));
  }

  return [{ ...ab, description: formatFixedMana(parsed.letters) }];
}

export function manaColorChoiceFromAction(action: {
  label: string;
  producedMana?: string;
}): string | null {
  const letters = extractManaLetters(action.label);
  if (letters.length !== 1) return null;
  const parsed = parseProducedMana(action.producedMana);
  if (!parsed) return letters[0];
  if (parsed.hasAny) return letters[0];
  if (parsed.isCombo) return letters[0];
  return parsed.letters.length === 1 ? letters[0] : null;
}

function extractProducedManaLetters(producedMana: string | undefined): string[] {
  return extractProducedManaTokens(producedMana)
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
    const producedExpansion = expandedFromProducedMana(ab);
    if (producedExpansion) {
      expanded.push(...producedExpansion);
      continue;
    }

    const letters = extractManaLetters(ab.description);
    const desc = ab.description.toLowerCase();
    const producedTokens = extractProducedManaTokens(ab.producedMana);
    const producedText = producedTokens.join(" ").toLowerCase();
    const producedLetters = extractProducedManaLetters(ab.producedMana);
    const isAnyColor =
      hasAnyColorText(desc) || hasAnyColorText(producedText) || producedTokens.includes("ANY");

    if (letters.length > 1 && isChoiceDescription(ab.description)) {
      uniqueLetters(letters).forEach((letter) => {
        expanded.push({
          ...ab,
          description: formatChoiceMana(letter),
        });
      });
    } else if (letters.length > 0) {
      expanded.push(ab);
    } else if (isAnyColor) {
      ANY_COLOR_LETTERS.forEach((letter) => {
        expanded.push({
          ...ab,
          description: formatChoiceMana(letter),
        });
      });
    } else if (producedLetters.length > 0) {
      const uniqueProducedLetters = uniqueLetters(producedLetters);
      if (uniqueProducedLetters.length === 1) {
        expanded.push({
          ...ab,
          description: formatChoiceMana(uniqueProducedLetters[0]),
        });
      } else {
        uniqueProducedLetters.forEach((letter) => {
          expanded.push({
            ...ab,
            description: formatChoiceMana(letter),
          });
        });
      }
    } else {
      expanded.push(ab);
    }
  }

  return expanded;
};
