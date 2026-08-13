import { useMemo } from "react";

import { collectionOwnership, type CollectionOwnership } from "@/lib/collection";
import type { DeckCard } from "@/protocol/deck";
import { useCollectionStore } from "@/stores/useCollectionStore";

export function useCardCollectionOwnership(card: DeckCard): CollectionOwnership {
  const quantities = useCollectionStore((state) => state.quantities);
  return useMemo(
    () =>
      collectionOwnership(
        quantities,
        card.identity.name,
        card.identity.setCode,
        card.identity.cardNumber,
        card.identity.foil,
      ),
    [card, quantities],
  );
}
