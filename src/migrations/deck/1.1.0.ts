import type { DeckCard } from "@/protocol/deck";
import type { EditorDeck } from "@/types/manabrew";
import type { SavedDeck } from "@/stores/useDeckStore";
import { fetchCardCollection, scryfallCardKey } from "@/api/scryfall";
import { needsScryfallEnrichment, scryfallToDeckCard } from "@/lib/scryfall.utils";

export type DeckCardPatch = Partial<Omit<DeckCard, "identity">>;

export interface DeckEnrichmentApi {
  savedDecks: SavedDeck[];
  currentDeck: EditorDeck;
  enrichSavedDeck: (id: string, updates: Map<string, DeckCardPatch>) => void;
  enrichDeckCards: (updates: Map<string, DeckCardPatch>) => void;
}

// Tokens are excluded — they resolve through the token archive, not Scryfall.
function sweepableCards(deck: EditorDeck): DeckCard[] {
  return [
    ...deck.cards,
    ...deck.sideboard,
    ...(deck.attractions ?? []),
    ...(deck.contraptions ?? []),
    ...(deck.schemes ?? []),
    ...(deck.planes ?? []),
    ...(deck.commanders ?? []),
    ...(deck.companion ? [deck.companion] : []),
    ...(deck.maybeboard ?? []),
  ];
}

// backFace and allParts come from Scryfall, so this migration has no sync
// transform. The fetch-backed half selects work by card shape rather than
// version stamp: an offline or failed load simply retries on the next start,
// and a converged deck no-ops.
export async function backfill(api: DeckEnrichmentApi): Promise<void> {
  const targets = [
    ...api.savedDecks.map((s) => ({ id: s.id as string | null, cards: sweepableCards(s.deck) })),
    { id: null, cards: sweepableCards(api.currentDeck) },
  ].map((t) => ({ ...t, stale: t.cards.filter(needsScryfallEnrichment) }));
  const toFetch = new Map<string, { name: string; setCode?: string }>();
  for (const t of targets) {
    for (const c of t.stale) {
      toFetch.set(scryfallCardKey(c.identity.name, c.identity.setCode), {
        name: c.identity.name,
        setCode: c.identity.setCode,
      });
    }
  }
  if (toFetch.size === 0) return;
  try {
    const scryfallMap = await fetchCardCollection([...toFetch.values()]);
    const updates = new Map<string, DeckCardPatch>();
    for (const [key, sc] of scryfallMap) {
      const { identity: _identity, ...patch } = scryfallToDeckCard(sc);
      updates.set(key, patch);
    }
    if (updates.size === 0) return;
    for (const t of targets) {
      if (t.stale.length === 0) continue;
      if (t.id === null) api.enrichDeckCards(updates);
      else api.enrichSavedDeck(t.id, updates);
    }
  } catch (err) {
    console.warn("[deck-migration] 1.1.0 backfill failed:", err);
  }
}
