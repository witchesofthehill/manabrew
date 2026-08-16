import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";

import {
  collectionPrintingsByName,
  collectionOwnership,
  type CollectionOwnedPrinting,
  type CollectionOwnership,
  type DeckOwnershipSummary,
} from "@/lib/collection";
import type { DeckCard } from "@/protocol/deck";

interface CardCollectionOwnershipContextValue {
  quantities: Record<string, number>;
  deckOwnership: Map<string, DeckOwnershipSummary>;
  printingsByName: Map<string, CollectionOwnedPrinting[]>;
}

const CardCollectionOwnershipContext = createContext<CardCollectionOwnershipContextValue>({
  quantities: {},
  deckOwnership: new Map(),
  printingsByName: new Map(),
});

export function CardCollectionOwnershipScope({
  quantities,
  deckOwnership,
  disabled,
  children,
}: {
  quantities: Record<string, number>;
  deckOwnership: Map<string, DeckOwnershipSummary>;
  disabled: boolean;
  children?: ReactNode;
}) {
  const value = useMemo(
    () => ({ quantities, deckOwnership, printingsByName: collectionPrintingsByName(quantities) }),
    [deckOwnership, quantities],
  );
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

export function useCardCollectionPrintings(card: DeckCard): CollectionOwnedPrinting[] {
  const { printingsByName } = useContext(CardCollectionOwnershipContext);
  return printingsByName.get(card.identity.name.toLowerCase()) ?? [];
}
