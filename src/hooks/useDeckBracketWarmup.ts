import { useEffect } from "react";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { presetSupportsEngine } from "@/lib/presetDecks";
import { deckBracket, hasFreshDeckBracket } from "@/lib/queueDecks";
import type { Deck } from "@/protocol/deck";
import { usePresetDecksStore } from "@/stores/usePresetDecksStore";

const WARMUP_DELAY_MS = 5_000;

function isCommanderDeck(deck: Deck): boolean {
  return deck.format === "commander" && (deck.commanders?.length ?? 0) > 0;
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function")
      requestIdleCallback(() => resolve(), { timeout: 3_000 });
    else setTimeout(resolve, 200);
  });
}

/** Checks Commander deck brackets one at a time while the app is idle, so Find a
 *  game opens with brackets already stored. Results persist in localStorage. */
export function useDeckBracketWarmup(enabled: boolean) {
  const owned = useOwnedDecks();
  const presets = usePresetDecksStore((state) => state.decks);

  useEffect(() => {
    if (!enabled) return;
    const pending = [
      ...owned.map(({ deck }) => deck),
      ...presets.filter((deck) => presetSupportsEngine(deck, "Forge")),
    ].filter((deck) => isCommanderDeck(deck) && !hasFreshDeckBracket(deck));
    if (pending.length === 0) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        for (const deck of pending) {
          await idle();
          if (cancelled) return;
          await deckBracket(deck).catch(() => undefined);
        }
      })();
    }, WARMUP_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, owned, presets]);
}
