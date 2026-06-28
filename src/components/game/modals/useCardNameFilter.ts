import { useMemo, useState } from "react";

const DEFAULT_THRESHOLD = 10;

export function useCardNameFilter<T extends { identity: { name: string } }>(
  cards: T[],
  threshold: number = DEFAULT_THRESHOLD,
) {
  const [query, setQuery] = useState("");
  const showFilter = cards.length > threshold;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!showFilter || !q) return cards;
    return cards.filter((card) => card.identity.name.toLowerCase().includes(q));
  }, [cards, query, showFilter]);

  return { query, setQuery, filtered, showFilter };
}
