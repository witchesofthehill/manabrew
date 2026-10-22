import { useEffect, useRef } from "react";
import { useGameStore } from "@/stores/useGameStore";
import { prefetchCards } from "@/stores/useScryfallStore";
import { asDeckCard, asGameDeckCard, getDeckCardPool } from "@/lib/decks";
import type { ClientGameView } from "@/stores/gameStore.types";
import type { Deck, DeckCard } from "@/protocol/deck";
import { renderCard, type CardRenderOptions } from "@/lib/cardRenderer";
import { releaseCardRaster, selectCardRenderTier } from "@/lib/cardRenderTypes";
import { GAME_CARD_SIZES } from "@/components/game/game.constants";
import { overlayResolution } from "@/pixi/overlay/overlayRuntime";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { gameCardFaceIndex } from "@/lib/gameCard";

export type GamePrefetchMode = "visible" | "full";

const FULL_PREFETCH_WAIT_CAP_MS = 10_000;

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

function manabrewRenderVariants(): CardRenderOptions[] {
  const preferences = usePreferencesStore.getState();
  const resolution = overlayResolution(window.innerWidth, window.innerHeight);
  const variants: CardRenderOptions[] = [];
  if (
    [
      preferences.handCardStyle,
      preferences.stackCardStyle,
      preferences.promptCardStyle,
      preferences.inGameCardPreviewStyle,
    ].includes("rules")
  ) {
    variants.push({
      rulesText: false,
      standardFrameFallback: true,
      tier: selectCardRenderTier(
        GAME_CARD_SIZES.hand.width,
        GAME_CARD_SIZES.hand.height,
        resolution,
      ),
    });
  }
  if (preferences.battlefieldCardStyle === "frame") {
    variants.push({
      tier: selectCardRenderTier(
        GAME_CARD_SIZES.battlefield.width,
        GAME_CARD_SIZES.battlefield.height,
        resolution,
      ),
    });
  }
  return variants;
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
  const total = variants.length * faces.length;
  if (total === 0) return;
  let loaded = 0;
  useGameStore.setState({ cardRenderProgress: { loaded, total } });
  await Promise.allSettled(
    variants.flatMap((options) =>
      faces.map((request) =>
        renderCard(request, undefined, options)
          .then(releaseCardRaster)
          .finally(() => {
            loaded += 1;
            useGameStore.setState({ cardRenderProgress: { loaded, total } });
          }),
      ),
    ),
  );
}

async function renderDeckPools(): Promise<void> {
  const { gameDecks, myPlayerSlot } = useGameStore.getState();
  const decks = Object.entries(gameDecks)
    .sort(([a], [b]) => Number(b === myPlayerSlot) - Number(a === myPlayerSlot))
    .map(([, deck]) => deck);
  const variants = manabrewRenderVariants();
  for (const deck of decks) {
    await Promise.allSettled(
      variants.flatMap((options) =>
        getDeckCardPool(deck).map((deckCard) =>
          renderCard({ deckCard, faceIndex: 0, gameplay: true }, undefined, {
            ...options,
            priority: "background",
          }).then(releaseCardRaster),
        ),
      ),
    );
  }
}

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
    const likelyCards = cardsToPrefetchNext(gameView, decks);
    let cancelled = false;
    let cancelIdle = () => {};
    const deckCards = Object.values(decks).flatMap(getDeckCardPool);
    const visibleCards = cardsToPrefetchImmediately(gameView, decks);
    const finish = async () => {
      await renderOpeningCards();
      useGameStore.setState({ isPrefetchingCards: false });
      void renderDeckPools();
    };
    if (mode === "full") {
      const cap = new Promise<void>((resolve) => setTimeout(resolve, FULL_PREFETCH_WAIT_CAP_MS));
      void Promise.all([
        prefetchCards(visibleCards),
        Promise.race([prefetchAllCards(visibleCards, deckCards), cap]),
      ]).finally(finish);
      return;
    }
    void prefetchCards(visibleCards).finally(finish);
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
