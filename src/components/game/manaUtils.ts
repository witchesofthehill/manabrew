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

function displayDescription(letters: string[]): string {
  return letters.length === 0
    ? "Add mana"
    : `Add ${letters.map((letter) => `{${letter}}`).join("")}`;
}

function displayFromProducedMana(ab: ManaAbilityActionInfo): ExpandedManaAbilityInfo | null {
  const mana = ab.producedMana;
  if (!mana || mana.length === 0) return null;

  const letters = mana.flatMap((m) => Array<string>(Math.max(m.amount, 1)).fill(m.color));
  if (letters.length === 0) return null;

  return {
    ...ab,
    description: displayDescription(letters),
    displayManaLetters: letters,
    colorChoice: mana.length === 1 ? mana[0].color : undefined,
  };
}

function displayFromDescription(ab: ManaAbilityActionInfo): ExpandedManaAbilityInfo {
  return {
    ...ab,
    displayManaLetters: extractManaLetters(ab.description),
    colorChoice: undefined,
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
