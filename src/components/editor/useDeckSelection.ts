import { useCallback, useRef, useState } from "react";

export function useDeckSelection() {
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const lastClickedRef = useRef<string | null>(null);

  const isSelected = useCallback(
    (cardName: string) => selectedCards.has(cardName.toLowerCase()),
    [selectedCards],
  );

  const toggleCard = useCallback((cardName: string) => {
    const key = cardName.toLowerCase();
    lastClickedRef.current = key;
    setSelectedCards((prev) => {
      const next = new Set(prev);
      if (prev.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  /**
   * Select all cards between the last-clicked card and `cardName` (inclusive),
   * based on their position in `orderedCardNames`. Falls back to a plain toggle
   * when there is no previous anchor or the card isn't found in the list.
   */
  const rangeSelect = useCallback((cardName: string, orderedCardNames: string[]) => {
    const key = cardName.toLowerCase();
    const last = lastClickedRef.current;
    lastClickedRef.current = key;

    if (!last) {
      setSelectedCards((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      return;
    }

    const lc = orderedCardNames.map((n) => n.toLowerCase());
    const fromIdx = lc.indexOf(last);
    const toIdx = lc.indexOf(key);

    if (fromIdx === -1 || toIdx === -1) {
      setSelectedCards((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      return;
    }

    const [start, end] = fromIdx <= toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
    setSelectedCards((prev) => {
      const next = new Set(prev);
      for (const n of lc.slice(start, end + 1)) next.add(n);
      return next;
    });
  }, []);

  const selectCards = useCallback((cardNames: string[], replaceSelection: boolean) => {
    setSelectedCards((prev) => {
      const next = replaceSelection ? new Set<string>() : new Set(prev);
      for (const name of cardNames) {
        next.add(name.toLowerCase());
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    lastClickedRef.current = null;
    setSelectedCards(new Set());
  }, []);

  const selectAll = useCallback((allCardNames: string[]) => {
    setSelectedCards(new Set(allCardNames.map((n) => n.toLowerCase())));
  }, []);

  return {
    selectedCards,
    isSelected,
    toggleCard,
    rangeSelect,
    selectCards,
    clearSelection,
    selectAll,
  };
}
