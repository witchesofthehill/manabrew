import type { DeckCard } from "@/protocol/deck";

export interface DeckLegality {
  commanderIdentity: ReadonlySet<string>;
  offIdentityCards: DeckCard[];
  maxDeckSize: number | null;
}

export interface Rulebreaker {
  name: string;
  rule: string;
  apply: (legality: DeckLegality) => DeckLegality;
}

export function exemptCards(exempt: (card: DeckCard) => boolean) {
  return (legality: DeckLegality): DeckLegality => ({
    ...legality,
    offIdentityCards: legality.offIdentityCards.filter((card) => !exempt(card)),
  });
}
