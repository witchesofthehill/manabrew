import { useEffect, useRef } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { prefetchCards } from "@/stores/useScryfallStore";
import { asDeckCard, getDeckCardPool } from "@/lib/decks";
import type { ClientGameView } from "@/stores/gameStore.types";
import type { Deck, DeckCard } from "@/protocol/deck";

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
function cardsToPrefetchNext(view: ClientGameView, gameDecks: Record<string, Deck>): DeckCard[] {
  const cards: DeckCard[] = [];
  const visible = [
    ...view.battlefield,
    ...view.players.flatMap((player) => [
      ...player.graveyard.slice(-4),
      ...player.exile.slice(-4),
      ...player.library.slice(0, 2),
    ]),
  ].filter((card) => !card.isFaceDown && card.identity.name !== "Hidden Card");
  for (const card of visible) {
    const deck = gameDecks[card.ownerId];
    if (deck) cards.push(asDeckCard(deck, card));
  }
  return cards;
}

function scheduleIdle(work: () => void): () => void {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const id = idleWindow.requestIdleCallback(work, { timeout: 3000 });
    return () => idleWindow.cancelIdleCallback?.(id);
  }
  const id = globalThis.setTimeout(work, 800);
  return () => globalThis.clearTimeout(id);
}

export function useGamePrefetch(): void {
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
    const likelyCards = cardsToPrefetchNext(gameView, decks);
    let cancelled = false;
    let cancelIdle = () => {};
    const deckCards = Object.values(decks).flatMap(getDeckCardPool);
    void prefetchCards(cardsToPrefetchImmediately(gameView, decks)).finally(() => {
      useGameStore.setState({ isPrefetchingCards: false });
    });
    void prefetchCards(likelyCards).then(() => {
      if (cancelled) return;
      cancelIdle = scheduleIdle(() => {
        void prefetchCards(deckCards).then(() => {
          if (cancelled) return;
          cancelIdle = scheduleIdle(() => void prefetchCards(deckCards, "art"));
        });
      });
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, [gameView, isPrefetchingCards]);
}
