import { fetchSets } from "@/api/scryfall";
import { prefetchCards, prefetchTokenArchive, useScryfallStore } from "@/stores/useScryfallStore";
import { useDeckStore } from "@/stores/useDeckStore";
import { getDefaultGameRuntime } from "@/game";
import { resolveCoverCard } from "@/components/deck/deckCover.utils";
import { prefetchPresetDecks } from "@/stores/usePresetDecksStore";
import type { Deck, DeckCard } from "@/protocol/deck";

let initPromise: Promise<void> | null = null;

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
  const presetDecks = await getDefaultGameRuntime()
    .api.getPresetDecks()
    .catch((e) => {
      console.error("[appInit] failed to load preset decks:", e);
      return [] as Deck[];
    });
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
    await Promise.all([
      initScryfallSets().catch((e) => console.error("[appInit] sets failed:", e)),
      prefetchPresetDecks().catch((e) => console.error("[appInit] preset enrichment failed:", e)),
      prefetchTokenArchive().catch((e) => console.error("[appInit] token archive failed:", e)),
    ]);
    await prefetchDeckCovers().catch((e) =>
      console.error("[appInit] deck cover prefetch failed:", e),
    );
  })();
  return initPromise;
}
