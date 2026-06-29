import type { CardDto } from "@/protocol/game";
import { isHorizontalCard } from "@/lib/cardLayout";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";

export function scryfallLayoutOf(card: CardDto): string | undefined {
  return (
    peekCard(useScryfallStore.getState().cards, {
      name: card.identity.name,
      setCode: card.identity.setCode,
      cardNumber: card.identity.cardNumber,
    })?.layout ?? undefined
  );
}

/** Horizontal-frame detection that survives a deck whose `layout` field isn't
 *  populated (split / aftermath / room report only their type line): fall back
 *  to the Scryfall-resolved layout, which the hand has already prefetched. */
export function isHorizontalGameCard(card: CardDto, deckLayout?: string): boolean {
  return isHorizontalCard({
    layout: deckLayout ?? scryfallLayoutOf(card),
    types: card.types,
  });
}
