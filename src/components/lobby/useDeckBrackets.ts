import { useEffect, useMemo, useState } from "react";
import { ANALYSIS_CONCURRENCY, cachedDeckBracket, deckBracket } from "@/lib/queueDecks";
import type { Deck } from "@/protocol/deck";

/** Brackets by deck id. Stored brackets show at once; the rest fill in as checks finish. */
export function useDeckBrackets(
  decks: { id: string; deck: Deck }[],
  enabled: boolean,
): Record<string, number> {
  const [checked, setChecked] = useState<Record<string, number>>({});
  const key = decks.map(({ id }) => id).join("\n");

  const cached = useMemo(() => {
    const result: Record<string, number> = {};
    for (const { id, deck } of decks) {
      const bracket = cachedDeckBracket(deck);
      if (bracket !== undefined) result[id] = bracket;
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < decks.length && !cancelled; i += ANALYSIS_CONCURRENCY) {
        await Promise.all(
          decks.slice(i, i + ANALYSIS_CONCURRENCY).map(async ({ id, deck }) => {
            try {
              const bracket = await deckBracket(deck);
              if (!cancelled) setChecked((current) => ({ ...current, [id]: bracket }));
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

  return useMemo(() => ({ ...cached, ...checked }), [cached, checked]);
}
