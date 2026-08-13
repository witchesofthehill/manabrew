import {
  collectionOwnership,
  type CollectionOwnership,
  type DeckOwnershipSummary,
} from "@/lib/collection";
import type { DeckCard } from "@/protocol/deck";

let collectionQuantities: Record<string, number> = {};
let deckOwnership = new Map<string, DeckOwnershipSummary>();

export function setCardCollectionOwnershipSnapshot(
  quantities: Record<string, number>,
  ownership: Map<string, DeckOwnershipSummary>,
) {
  collectionQuantities = quantities;
  deckOwnership = ownership;
}

export function useCardCollectionOwnership(card: DeckCard): CollectionOwnership {
  return collectionOwnership(
    collectionQuantities,
    card.identity.name,
    card.identity.setCode,
    card.identity.cardNumber,
    card.identity.foil,
  );
}

export function useDeckCardOwnership(card: DeckCard): DeckOwnershipSummary | undefined {
  return deckOwnership.get(card.identity.name.toLowerCase());
}
