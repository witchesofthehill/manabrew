import { useEffect, useRef } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { prefetchCards } from "@/stores/useScryfallStore";
import { asDeckCard, asGameDeckCard, getDeckCardPool } from "@/lib/decks";
import type { ClientGameView } from "@/stores/gameStore.types";
import type { Deck, DeckCard } from "@/protocol/deck";
import { renderCard } from "@/lib/cardRenderer";
import { releaseCardRaster } from "@/lib/cardRenderTypes";
import { libraryTopRendered, manabrewRenderVariants, warmDeckFaces } from "@/lib/cardFaceWarmup";
import { isForgeWasmActive } from "@/lib/forgeWasm";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { gameCardFaceIndex } from "@/lib/gameCard";

export type GamePrefetchMode = "visible" | "full";

const GAME_LOADING_CAP_MS = 10_000;
const LIBRARY_TOP_ARRIVAL_MS = 3_000;

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

async function renderOpeningCards(): Promise<void> {
  const { gameView, gameDecks } = useGameStore.getState();
  const faces = (gameView?.players ?? [])
    .flatMap((player) => [...player.hand, ...player.commandZone])
    .filter(
      (card) => !card.isFaceDown && card.identity.name && card.identity.name !== "Hidden Card",
    )
    .flatMap((card) => {
      const deckCard = asGameDeckCard(gameDecks, card);
      const faceIndex = gameCardFaceIndex(card);
      const indices: (0 | 1)[] = deckCard.backFace
        ? [faceIndex, faceIndex === 0 ? 1 : 0]
        : [faceIndex];
      return indices.map((face) => ({ card, deckCard, faceIndex: face }));
    });
  const variants = manabrewRenderVariants();
  if (variants.length * faces.length === 0) return;
  useGameStore.setState({ isRenderingCards: true });
  await Promise.allSettled(
    variants.flatMap((options) =>
      faces.map((request) => renderCard(request, undefined, options).then(releaseCardRaster)),
    ),
  );
}

function renderOpeningHand(since: number): Promise<unknown> | undefined {
  const { gameView, myPlayerSlot, isMultiplayer, isHost } = useGameStore.getState();
  const me = gameView?.players.find((player) => player.id === myPlayerSlot);
  if (!isForgeWasmActive() || (isMultiplayer && !isHost) || !me || me.hand.length > 0) return;
  return libraryTopRendered(since, LIBRARY_TOP_ARRIVAL_MS);
}

function renderDeckPools(): void {
  const { gameDecks, myPlayerSlot } = useGameStore.getState();
  const decks = Object.entries(gameDecks);
  void warmDeckFaces(
    decks.filter(([slot]) => slot === myPlayerSlot).map(([, deck]) => deck),
    decks.filter(([slot]) => slot !== myPlayerSlot).map(([, deck]) => deck),
  );
}

export function useGamePrefetch(mode: GamePrefetchMode): void {
  const gameView = useGameStore((s) => s.gameView);
  const isPrefetchingCards = useGameStore((s) => s.isPrefetchingCards);
  const startedRef = useRef(false);
  const loadingSinceRef = useRef(0);

  useEffect(() => {
    if (!isPrefetchingCards) {
      startedRef.current = false;
      loadingSinceRef.current = 0;
      return;
    }
    loadingSinceRef.current ||= performance.now();
    if (!gameView || startedRef.current) return;
    startedRef.current = true;

    const decks = useGameStore.getState().gameDecks;
    const likelyCards = cardsToPrefetchNext(gameView, decks);
    let cancelled = false;
    let cancelIdle = () => {};
    const deckCards = Object.values(decks).flatMap(getDeckCardPool);
    const visibleCards = cardsToPrefetchImmediately(gameView, decks);
    const waitForDeck =
      mode === "full" && usePreferencesStore.getState().battlefieldCardStyle !== "frame";
    const ready = Promise.all([
      prefetchCards(visibleCards).then(renderOpeningCards),
      waitForDeck ? prefetchAllCards(visibleCards, deckCards) : undefined,
      renderOpeningHand(loadingSinceRef.current),
    ]);
    const cap = new Promise<void>((resolve) => setTimeout(resolve, GAME_LOADING_CAP_MS));
    void Promise.race([ready, cap]).finally(() => {
      useGameStore.setState({ isPrefetchingCards: false });
      renderDeckPools();
    });
    if (waitForDeck) return;
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
  }, [gameView, isPrefetchingCards, mode]);
}
