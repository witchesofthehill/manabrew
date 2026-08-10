import { useCallback, useMemo, useState } from "react";
import type { ClientCardDto } from "@/stores/gameStore.types";

const NO_CARDS: ClientCardDto[] = [];

/** Hand order the player set by dragging cards around the fan. The engine order
 *  is the baseline: a card that was never moved stays where the engine put it,
 *  and freshly drawn cards land at the right end. The order is per-mount, so a
 *  new game starts from the engine order again. */
export function useHandOrder(hand: ClientCardDto[] | undefined) {
  const cards = hand ?? NO_CARDS;
  const [order, setOrder] = useState<string[]>([]);

  const orderedHand = useMemo(() => {
    if (order.length === 0) return cards;
    const byId = new Map(cards.map((card) => [card.id, card]));
    const moved = order.flatMap((id) => {
      const card = byId.get(id);
      return card ? [card] : [];
    });
    const movedIds = new Set(moved.map((card) => card.id));
    return [...moved, ...cards.filter((card) => !movedIds.has(card.id))];
  }, [cards, order]);

  const moveHandCard = useCallback(
    (cardId: string, toIndex: number) => {
      const ids = orderedHand.map((card) => card.id);
      const from = ids.indexOf(cardId);
      if (from === -1) return;
      ids.splice(from, 1);
      ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, cardId);
      setOrder(ids);
    },
    [orderedHand],
  );

  return { orderedHand, moveHandCard };
}
