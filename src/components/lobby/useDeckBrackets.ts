import { useEffect, useState } from "react";
import { ANALYSIS_CONCURRENCY, deckBracket } from "@/lib/queueDecks";
import type { Deck } from "@/protocol/deck";

export function useDeckBrackets(
  decks: { id: string; deck: Deck }[],
  enabled: boolean,
): Record<string, number> {
  const [brackets, setBrackets] = useState<Record<string, number>>({});
  const key = decks.map(({ id }) => id).join("\n");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < decks.length && !cancelled; i += ANALYSIS_CONCURRENCY) {
        await Promise.all(
          decks.slice(i, i + ANALYSIS_CONCURRENCY).map(async ({ id, deck }) => {
            try {
              const bracket = await deckBracket(deck);
              if (!cancelled) setBrackets((current) => ({ ...current, [id]: bracket }));
            } catch (error) {
              console.warn("[matchmaking] bracket analysis failed", error);
            }
          }),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  return brackets;
}
