import { useEffect, useRef } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { prefetchCards } from "@/stores/useScryfallStore";
import { asDeckCard, getDeckCardPool } from "@/lib/decks";
import type { GameViewDto } from "@/protocol/game";
import type { Deck, DeckCard } from "@/protocol/deck";

/** Cards whose textures must be decoded before the game UI flips on:
 *  hand, both command zones, and a small head-start of each deck list for
 *  early draws. The full deck pool gets fired-and-forgotten in the same
 *  pass — `getCardTexture` is idempotent so the critical entries aren't
 *  re-fetched. */
function cardsToPrefetchImmediately(
  view: GameViewDto,
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

/** When the first `gameView` arrives at game start, await the critical
 *  textures and fire-and-forget the rest. Flips `isPrefetchingCards` off
 *  so the loading screen yields to the board. */
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
    void prefetchCards(cardsToPrefetchImmediately(gameView, decks)).finally(() => {
      useGameStore.setState({ isPrefetchingCards: false });
    });
    void prefetchCards(Object.values(decks).flatMap(getDeckCardPool));
  }, [gameView, isPrefetchingCards]);
}
