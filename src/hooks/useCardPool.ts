import { useEffect, useMemo } from "react";
import {
  resolveDeckSections,
  type CardPool,
  type DeckValidationInput,
  type GameFormat,
} from "@/lib/formats";
import { useCardPoolStore } from "@/stores/useCardPoolStore";

export interface CardPoolCheck {
  input: DeckValidationInput;
  format: GameFormat | null | undefined;
}

export function useCardPool(checks: CardPoolCheck[]): CardPool {
  const cards = useCardPoolStore((s) => s.cards);
  const error = useCardPoolStore((s) => s.error);
  const ensureLoaded = useCardPoolStore((s) => s.ensureLoaded);

  const names = new Set<string>();
  const commanderNames = new Set<string>();
  for (const { input, format } of checks) {
    if (!format?.cardPool) continue;
    const { commanders, mainDeck } = resolveDeckSections(input);
    for (const card of mainDeck) names.add(card.identity.name);
    for (const card of commanders) {
      names.add(card.identity.name);
      if (format.cardPool.commanderRarity) commanderNames.add(card.identity.name);
    }
  }
  const requestKey = JSON.stringify([[...names].sort(), [...commanderNames].sort()]);
  const request = useMemo(() => JSON.parse(requestKey) as [string[], string[]], [requestKey]);

  useEffect(() => {
    if (request[0].length > 0) void ensureLoaded(request[0], request[1]);
  }, [request, cards, ensureLoaded]);

  return useMemo(() => ({ cards, error }), [cards, error]);
}
