import {
  canBeOathbreaker,
  canBeSignatureSpell,
  commanderPairLabel,
  isCommanderEligible,
} from "@/lib/formats";
import type { Deck, DeckCard } from "@/protocol/deck";
import type { CompanionCommanderRef } from "@/stores/useCompanionStore.types";

function toCommanderRef(card: DeckCard): CompanionCommanderRef {
  return { name: card.identity.name, imageUrl: card.uris.art_crop || card.uris.small || undefined };
}

export function commanderSlotsFromDeck(
  deck: Deck,
  oathbreaker: boolean,
  commanderName?: string,
): [CompanionCommanderRef, CompanionCommanderRef | null] | null {
  if (deck.format && (deck.format === "oathbreaker") !== oathbreaker) return null;
  const cards = deck.commanders ?? [];
  const selected = commanderName
    ? (cards.find((card) => card.identity.name === commanderName) ??
      deck.cards.find(
        (card) =>
          card.identity.name === commanderName &&
          (oathbreaker ? canBeOathbreaker(card) : isCommanderEligible(card)),
      ))
    : undefined;
  if (commanderName && !selected) return null;
  const primary = oathbreaker
    ? selected && canBeOathbreaker(selected)
      ? selected
      : cards.find(canBeOathbreaker)
    : (selected ?? cards[0]);
  const secondary = oathbreaker
    ? cards.find(canBeSignatureSpell)
    : primary === cards[0]
      ? cards[1]
      : primary === cards[1] && commanderPairLabel(cards, deck.format)
        ? cards[0]
        : undefined;
  return primary ? [toCommanderRef(primary), secondary ? toCommanderRef(secondary) : null] : null;
}
