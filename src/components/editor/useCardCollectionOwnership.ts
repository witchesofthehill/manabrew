import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";

import {
  collectionOwnership,
  type CollectionOwnership,
  type DeckOwnershipSummary,
} from "@/lib/collection";
import type { DeckCard } from "@/protocol/deck";

interface CardCollectionOwnershipContextValue {
  quantities: Record<string, number>;
  deckOwnership: Map<string, DeckOwnershipSummary>;
}

const CardCollectionOwnershipContext = createContext<CardCollectionOwnershipContextValue>({
  quantities: {},
  deckOwnership: new Map(),
});

export function CardCollectionOwnershipScope({
  quantities,
  deckOwnership,
  disabled,
  children,
}: CardCollectionOwnershipContextValue & { disabled: boolean; children?: ReactNode }) {
  const value = useMemo(() => ({ quantities, deckOwnership }), [deckOwnership, quantities]);
  return createElement(
    CardCollectionOwnershipContext.Provider,
    { value },
    createElement("fieldset", { disabled, className: "contents" }, children),
  );
}

export function useCardCollectionOwnership(card: DeckCard): CollectionOwnership {
  const { quantities } = useContext(CardCollectionOwnershipContext);
  return collectionOwnership(
    quantities,
    card.identity.name,
    card.identity.setCode,
    card.identity.cardNumber,
    card.identity.foil,
  );
}

export function useDeckCardOwnership(card: DeckCard): DeckOwnershipSummary | undefined {
  const { deckOwnership } = useContext(CardCollectionOwnershipContext);
  return deckOwnership.get(card.identity.name.toLowerCase());
}
