import type { Deck, DeckCard } from "@/protocol/deck";

export function resolveCoverCard(deck: Deck): DeckCard | undefined {
  const allCards = [...deck.cards, ...(deck.commanders ?? [])];
  if (deck.coverCardName) {
    const found = allCards.find((card) => card.name === deck.coverCardName);
    if (found) return found;
  }
  return deck.commanders?.[0] ?? deck.cards[0];
}

export const resolvePresetDeck = (presetDeck: Deck): DeckCard | undefined =>
  resolveCoverCard(presetDeck);
