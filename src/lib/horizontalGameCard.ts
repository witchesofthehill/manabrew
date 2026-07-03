import type { CardDto } from "@/protocol/game";
import { isHorizontalCard } from "@/lib/cardLayout";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";

function peekScryfall(card: CardDto) {
  const { name, setCode, cardNumber } = card.identity;
  // Empty set/number (e.g. the dev debug card) must fall through to a name-only
  // lookup — passing "" would build a set+number key that never matches.
  return peekCard(useScryfallStore.getState().cards, {
    name,
    setCode: setCode || undefined,
    cardNumber: cardNumber || undefined,
  });
}

export function scryfallLayoutOf(card: CardDto): string | undefined {
  return peekScryfall(card)?.layout ?? undefined;
}

/** Horizontal-frame detection that survives a deck whose `layout` field isn't
 *  populated (split / aftermath / room report only their type line): fall back
 *  to the Scryfall-resolved layout and type line, which the hand has already
 *  prefetched. The type line catches type-based horizontals (Battle / Plane /
 *  Phenomenon / Scheme) whose `types` array the source DTO may not carry. */
export function isHorizontalGameCard(card: CardDto, deckLayout?: string): boolean {
  const scry = peekScryfall(card);
  return isHorizontalCard({
    layout: deckLayout ?? scry?.layout ?? undefined,
    types: card.types,
    typeLine: scry?.type_line,
  });
}
