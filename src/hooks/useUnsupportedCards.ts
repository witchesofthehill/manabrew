import { useEffect, useMemo } from "react";
import { useCardSupportStore, selectUnsupportedNames } from "@/stores/useCardSupportStore";
import type { Deck } from "@/protocol/deck";

function collectDeckNames(deck: Deck): string[] {
  const names = new Set<string>();
  const push = (name: string | undefined) => {
    if (name) names.add(name);
  };
  for (const c of deck.cards) push(c.name);
  for (const c of deck.sideboard) push(c.name);
  for (const c of deck.commanders ?? []) push(c.name);
  for (const c of deck.maybeboard ?? []) push(c.name);
  for (const c of deck.attractions ?? []) push(c.name);
  for (const c of deck.contraptions ?? []) push(c.name);
  for (const c of deck.schemes ?? []) push(c.name);
  for (const c of deck.planes ?? []) push(c.name);
  if (deck.companion) push(deck.companion.name);
  return [...names];
}

export function useUnsupportedCards(deck: Deck): Set<string> {
  const names = useMemo(() => collectDeckNames(deck), [deck]);
  const ensureChecked = useCardSupportStore((s) => s.ensureChecked);
  const status = useCardSupportStore((s) => s.status);

  useEffect(() => {
    if (names.length > 0) void ensureChecked(names);
  }, [names, ensureChecked]);

  return useMemo(
    () => selectUnsupportedNames({ status, ensureChecked }, names),
    [status, names, ensureChecked],
  );
}
