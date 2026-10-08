import { useEffect, useMemo, useState } from "react";
import {
  cardKey,
  peekCard,
  useScryfallStore,
  type ScryfallCardLookup,
} from "@/stores/useScryfallStore";
import type { DraftCard } from "@/types/limited";

export function useLimitedAnalysisMetadata(cards: DraftCard[]) {
  const cache = useScryfallStore((state) => state.cards);
  const locale = useScryfallStore((state) => state.locale);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [retry, setRetry] = useState(0);
  const signature = JSON.stringify(
    cards.map((card) => ({
      name: card.name,
      setCode: card.setCode,
      cardNumber: card.cardNumber,
    })),
  );
  const lookups = useMemo(() => {
    const unique: Record<string, ScryfallCardLookup> = {};
    for (const lookup of JSON.parse(signature) as ScryfallCardLookup[])
      unique[cardKey(lookup)] = lookup;
    return Object.values(unique);
  }, [signature]);
  useEffect(() => {
    let active = true;
    setErrors({});
    const queue = lookups.filter((lookup) => !peekCard(useScryfallStore.getState().cards, lookup));
    const load = async () => {
      while (queue.length && active) {
        const lookup = queue.shift()!;
        try {
          await useScryfallStore.getState().getCard(lookup);
        } catch (error) {
          if (active)
            setErrors((previous) => ({
              ...previous,
              [cardKey(lookup)]:
                `${lookup.name}: ${error instanceof Error ? error.message : String(error)}`,
            }));
        }
      }
    };
    for (let worker = 0; worker < Math.min(6, queue.length); worker += 1) void load();
    return () => {
      active = false;
    };
  }, [lookups, locale, retry]);
  const missing = lookups.filter((lookup) => !peekCard(cache, lookup));
  return {
    cache,
    errors: missing.flatMap((lookup) => (errors[cardKey(lookup)] ? [errors[cardKey(lookup)]] : [])),
    loading: missing.some((lookup) => !errors[cardKey(lookup)]),
    retry: () => setRetry((value) => value + 1),
  };
}
