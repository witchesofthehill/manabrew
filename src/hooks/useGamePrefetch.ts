import { useEffect, useRef } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { prefetchCards } from "@/stores/useScryfallStore";
import { asDeckCard, getDeckCardPool } from "@/lib/decks";
import type { ClientGameView } from "@/stores/gameStore.types";
import type { Deck, DeckCard } from "@/protocol/deck";

export type GamePrefetchMode = "visible" | "full";

const FULL_PREFETCH_WAIT_CAP_MS = 10_000;

/** Cards whose printed textures must be decoded before the game UI flips on:
 *  hand, both command zones, and a small head-start of each deck list for
 *  early draws. `getCardTexture` is idempotent so duplicate entries aren't
 *  re-fetched. */
function cardsToPrefetchImmediately(
  view: ClientGameView,
  gameDecks: Record<string, Deck>,
): DeckCard[] {
  const cards: DeckCard[] = [];
  const visible = view.players
    .flatMap((p) => [...p.hand, ...p.commandZone])
    .filter((card) => !card.isFaceDown && card.identity.name !== "Hidden Card");
  for (const gc of visible) {
    const deck = gameDecks[gc.ownerId];
    if (deck) cards.push(asDeckCard(deck, gc));
  }
  for (const deck of Object.values(gameDecks)) {
    cards.push(...deck.cards.slice(0, 5));
  }
  return cards;
}

async function prefetchAllCards(visibleCards: DeckCard[], deckCards: DeckCard[]): Promise<void> {
  const printedCards = [...visibleCards, ...deckCards];
  const total = printedCards.length + deckCards.length;
  let loaded = 0;
  useGameStore.setState({ cardPrefetchProgress: { loaded, total } });
  const onSettled = () => {
    loaded += 1;
    useGameStore.setState({ cardPrefetchProgress: { loaded, total } });
  };
  await prefetchCards(printedCards, "full", onSettled);
  await prefetchCards(deckCards, "art", onSettled);
}

/** When the first `gameView` arrives at game start, prefetch per `mode`,
 *  then flip `isPrefetchingCards` off so the loading screen yields to the
 *  board. */
export function useGamePrefetch(mode: GamePrefetchMode): void {
  const gameView = useGameStore((s) => s.gameView);
  const isPrefetchingCards = useGameStore((s) => s.isPrefetchingCards);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isPrefetchingCards) {
      startedRef.current = false;
      return;
    }
    if (!gameView || startedRef.current) return;
    startedRef.current = true;

    const decks = useGameStore.getState().gameDecks;
    const deckCards = Object.values(decks).flatMap(getDeckCardPool);
    const visibleCards = cardsToPrefetchImmediately(gameView, decks);
    const finish = () => useGameStore.setState({ isPrefetchingCards: false });
    if (mode === "full") {
      const cap = new Promise<void>((resolve) => setTimeout(resolve, FULL_PREFETCH_WAIT_CAP_MS));
      void Promise.all([
        prefetchCards(visibleCards),
        Promise.race([prefetchAllCards(visibleCards, deckCards), cap]),
      ]).finally(finish);
      return;
    }
    void prefetchCards(visibleCards).finally(finish);
    void prefetchCards(deckCards).then(() => prefetchCards(deckCards, "art"));
  }, [gameView, isPrefetchingCards, mode]);
}
