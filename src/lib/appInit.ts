import { fetchSets } from "@/api/scryfall";
import { prefetchCards, prefetchTokenArchive, useScryfallStore } from "@/stores/useScryfallStore";
import { useDeckStore } from "@/stores/useDeckStore";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { prefetchPresetDecks, usePresetDecksStore } from "@/stores/usePresetDecksStore";
import type { DeckCard } from "@/protocol/deck";
import { initializeForgeRoomAvailability } from "@/stores/useForgeRoomAvailabilityStore";
import { getEventBus, getPlatform } from "@/platform";
import type { AppInitStage } from "@/stores/useAppInitStore";

let initPromise: Promise<void> | null = null;

function postStage(stage: AppInitStage): void {
  getEventBus().emit("app:init", { stage });
}

async function initScryfallSets(): Promise<void> {
  if (useScryfallStore.getState().sets?.length) return;
  const sets = await fetchSets();
  useScryfallStore.setState({ sets });
}

/**
 * Warm the texture cache for every visible deck-list cover image. Per-card
 * images are fetched on demand by the deck builder (`<img src=...>`) and at
 * game start (`initializeGame` → `prefetchCards`). Doing more here saturates
 * the Scryfall image queue and starves the active game's prefetch.
 */
async function prefetchDeckCovers(): Promise<void> {
  await prefetchPresetDecks();
  const presetDecks = usePresetDecksStore.getState().decks;
  const { savedDecks = [], currentDeck } = useDeckStore.getState();
  const seen = new Set<string>();
  const covers: DeckCard[] = [];
  const push = (c: DeckCard | null | undefined) => {
    if (!c) return;
    const { name, setCode, cardNumber } = c.identity;
    const k = `${name.toLowerCase()}::${setCode.toLowerCase()}::${cardNumber.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    covers.push(c);
  };
  for (const d of presetDecks) push(resolveCoverCard(d));
  for (const sd of savedDecks) push(resolveCoverCard(sd.deck));
  if (currentDeck) push(resolveCoverCard(currentDeck));
  console.log(
    `[appInit] prefetching ${covers.length} deck covers (preset=${presetDecks.length}, saved=${savedDecks.length}, current=${currentDeck ? 1 : 0})`,
  );
  await prefetchCards(covers);
}

export function initApp(): Promise<void> {
  console.log("[appInit] initializing...");
  if (initPromise) return initPromise;
  initPromise = (async () => {
    // The engine worker boots alongside the app, never in front of it: a
    // player on the Forge engine needs none of it, and a browser without
    // cross-origin isolation never gets it at all.
    void getPlatform()
      .init()
      .catch((e) => console.error("[appInit] engine init failed:", e));

    // `ready` releases the init gate, so it has to survive anything thrown
    // above it — the app degrades without its warm caches, it does not close.
    try {
      postStage("assets");
      await Promise.all([
        initializeForgeRoomAvailability(),
        initScryfallSets().catch((e) => console.error("[appInit] sets failed:", e)),
        prefetchPresetDecks().catch((e) => console.error("[appInit] preset enrichment failed:", e)),
        prefetchTokenArchive().catch((e) => console.error("[appInit] token archive failed:", e)),
      ]);
      postStage("decks");
      await prefetchDeckCovers().catch((e) =>
        console.error("[appInit] deck cover prefetch failed:", e),
      );
    } finally {
      postStage("ready");
    }
  })();
  return initPromise;
}
