import { useEffect, useMemo } from "react";

import { useDeckStore } from "@/stores/useDeckStore";
import { useCardRolesStore } from "@/stores/useCardRolesStore";

export function useDeckRoles(): void {
  const deck = useDeckStore((state) => state.currentDeck);
  const ensureAnalyzed = useCardRolesStore((state) => state.ensureAnalyzed);
  const cards = useMemo(
    () => [...deck.cards, ...deck.sideboard, ...(deck.commanders ?? [])],
    [deck.cards, deck.sideboard, deck.commanders],
  );

  useEffect(() => {
    void ensureAnalyzed(cards);
  }, [cards, ensureAnalyzed]);
}
