import { useCallback, useMemo, useState } from "react";
import type { CardDto } from "@/protocol/game";
import { orderHandCards, reconcileHandOrder, type HandOrderMode } from "@/lib/handOrder";

interface HandOrderState {
  cards: CardDto[];
  moveCard: (cardId: string, toIndex: number) => void;
  setMode: (mode: HandOrderMode) => void;
}

export function useHandOrder(
  cards: readonly CardDto[],
  mode: HandOrderMode,
  onModeChange: (mode: HandOrderMode) => void,
): HandOrderState {
  const [manualOrder, setManualOrder] = useState(() => cards.map((card) => card.id));
  const reconciledManualOrder = useMemo(
    () => reconcileHandOrder(manualOrder, cards),
    [cards, manualOrder],
  );
  const orderedCards = useMemo(
    () => orderHandCards(cards, mode, reconciledManualOrder),
    [cards, mode, reconciledManualOrder],
  );
  const orderedIds = useMemo(() => orderedCards.map((card) => card.id), [orderedCards]);

  const moveCard = useCallback(
    (cardId: string, toIndex: number) => {
      const nextOrder = orderedIds.filter((id) => id !== cardId);
      nextOrder.splice(Math.max(0, Math.min(toIndex, nextOrder.length)), 0, cardId);
      setManualOrder(nextOrder);
      if (mode !== "manual") onModeChange("manual");
    },
    [mode, onModeChange, orderedIds],
  );

  const setMode = useCallback(
    (nextMode: HandOrderMode) => {
      if (nextMode === mode) return;
      setManualOrder(orderedIds);
      onModeChange(nextMode);
    },
    [mode, onModeChange, orderedIds],
  );

  return { cards: orderedCards, moveCard, setMode };
}
