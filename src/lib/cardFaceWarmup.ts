import type { Deck, DeckCard } from "@/protocol/deck";
import type { CardIdentity } from "@/protocol/game";
import { getDeckCardPool } from "@/lib/decks";
import { renderCard, type CardRenderOptions } from "@/lib/cardRenderer";
import { releaseCardRaster, selectCardRenderTier } from "@/lib/cardRenderTypes";
import type { CardRenderPriority } from "@/lib/cardRenderQueue";
import { GAME_CARD_SIZES } from "@/components/game/game.constants";
import { overlayResolution } from "@/pixi/overlay/overlayRuntime";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

const WARM_BATCH = 8;
const LAST_PLAYABLE_RANK = 99;

let warmGeneration = 0;
const knownDeckCards = new Map<string, DeckCard>();
let libraryTop: { at: number; rendered: Promise<unknown> } | null = null;
const libraryTopWaiters = new Set<() => void>();

const identityKey = (identity: { name: string; setCode: string; cardNumber: string }) =>
  `${identity.name}|${identity.setCode.toLowerCase()}|${identity.cardNumber}`;

function rulesTiers() {
  const preferences = usePreferencesStore.getState();
  const resolution = overlayResolution(window.innerWidth, window.innerHeight);
  return {
    hand: selectCardRenderTier(
      GAME_CARD_SIZES.hand.width * preferences.cardSizeMultiplier,
      GAME_CARD_SIZES.hand.height * preferences.cardSizeMultiplier,
      resolution,
    ),
    prompt: selectCardRenderTier(
      GAME_CARD_SIZES.prompt.width,
      GAME_CARD_SIZES.prompt.height,
      resolution,
    ),
  };
}

function usesRulesFaces(): boolean {
  const preferences = usePreferencesStore.getState();
  return [
    preferences.handCardStyle,
    preferences.stackCardStyle,
    preferences.promptCardStyle,
    preferences.inGameCardPreviewStyle,
  ].includes("rules");
}

export function manabrewRenderVariants(): CardRenderOptions[] {
  const variants: CardRenderOptions[] = [];
  if (usesRulesFaces())
    variants.push({ rulesText: false, standardFrameFallback: true, tier: rulesTiers().hand });
  if (usePreferencesStore.getState().battlefieldCardStyle === "frame") {
    variants.push({
      tier: selectCardRenderTier(
        GAME_CARD_SIZES.battlefield.width,
        GAME_CARD_SIZES.battlefield.height,
        overlayResolution(window.innerWidth, window.innerHeight),
      ),
    });
  }
  return variants;
}

function laterRenderVariants(): CardRenderOptions[] {
  const { hand, prompt } = rulesTiers();
  return usesRulesFaces() && prompt !== hand
    ? [{ rulesText: false, standardFrameFallback: true, tier: prompt }]
    : [];
}

function renderFaces(
  deckCards: readonly DeckCard[],
  priority: CardRenderPriority,
  variants = manabrewRenderVariants(),
) {
  return deckCards.flatMap((deckCard) =>
    variants.flatMap((options) =>
      (deckCard.backFace ? ([0, 1] as const) : ([0] as const)).map(
        (faceIndex) => () =>
          renderCard({ deckCard, faceIndex, gameplay: true }, undefined, {
            ...options,
            priority,
          }).then(releaseCardRaster),
      ),
    ),
  );
}

function playableRank(deckCard: DeckCard, own: boolean): number {
  return Math.min(deckCard.cmc ?? 0, LAST_PLAYABLE_RANK - 1) * 2 + (own ? 0 : 1);
}

function warmOrder(own: readonly Deck[], others: readonly Deck[]): DeckCard[] {
  const ranked = new Map<string, { deckCard: DeckCard; rank: number }>();
  const add = (deckCard: DeckCard, rank: number) => {
    const key = identityKey(deckCard.identity);
    knownDeckCards.set(key, deckCard);
    const existing = ranked.get(key);
    if (!existing || rank < existing.rank) ranked.set(key, { deckCard, rank });
  };
  for (const [decks, isOwn] of [
    [own, true],
    [others, false],
  ] as const) {
    for (const deck of decks) {
      for (const deckCard of [...deck.cards, ...(deck.commanders ?? [])])
        add(deckCard, playableRank(deckCard, isOwn));
      for (const deckCard of getDeckCardPool(deck))
        add(deckCard, LAST_PLAYABLE_RANK * 2 + (isOwn ? 0 : 1));
    }
  }
  return [...ranked.values()].sort((a, b) => a.rank - b.rank).map(({ deckCard }) => deckCard);
}

export async function warmDeckFaces(
  own: readonly Deck[],
  others: readonly Deck[] = [],
): Promise<void> {
  const generation = ++warmGeneration;
  const cards = warmOrder(own, others);
  const renders = [
    ...renderFaces(cards, "background"),
    ...renderFaces(cards, "background", laterRenderVariants()),
  ];
  for (let index = 0; index < renders.length; index += WARM_BATCH) {
    if (generation !== warmGeneration) return;
    await Promise.allSettled(renders.slice(index, index + WARM_BATCH).map((render) => render()));
  }
}

export function warmLibraryTop(cards: readonly CardIdentity[]): void {
  const deckCards = cards.flatMap((identity) => {
    const deckCard = knownDeckCards.get(identityKey(identity));
    return deckCard ? [deckCard] : [];
  });
  const renders = manabrewRenderVariants().flatMap((options) =>
    renderFaces(deckCards, "visible", [options]).map((render) => render()),
  );
  libraryTop = { at: performance.now(), rendered: Promise.allSettled(renders) };
  for (const waiter of libraryTopWaiters) waiter();
  libraryTopWaiters.clear();
}

export function libraryTopRendered(since: number, arrivalMs: number): Promise<unknown> {
  if (libraryTop && libraryTop.at >= since) return libraryTop.rendered;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      libraryTopWaiters.delete(waiter);
      resolve(undefined);
    }, arrivalMs);
    const waiter = () => {
      clearTimeout(timer);
      resolve(libraryTop?.rendered);
    };
    libraryTopWaiters.add(waiter);
  });
}
