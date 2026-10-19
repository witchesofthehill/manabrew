import { create } from "zustand";
import { fetchCardCollection, fetchPrintsByOracleIds, scryfallCardKey } from "@/api/scryfall";
import { cardPoolKey, type CardPool } from "@/lib/formats";
import type { ScryfallCard } from "@/types/scryfall";

interface CardPoolState extends CardPool {
  ensureLoaded: (names: string[], commanderNames: string[]) => Promise<void>;
}

const pendingCards = new Set<string>();
const pendingPrintings = new Set<string>();

// PDH 906.5f/906.12: only traditional paper cards and MTGO cards count;
// oversized and memorabilia printings (30A, World Championship decks) do not.
function countsTowardRarity(printing: ScryfallCard): boolean {
  if (printing.games.includes("mtgo")) return true;
  return (
    printing.games.includes("paper") && !printing.oversized && printing.set_type !== "memorabilia"
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useCardPoolStore = create<CardPoolState>((set, get) => ({
  cards: {},
  error: null,
  ensureLoaded: async (names, commanderNames) => {
    const missing = [...new Set(names)].filter((name) => {
      const key = cardPoolKey(name);
      return get().cards[key] === undefined && !pendingCards.has(key);
    });
    if (missing.length > 0) {
      for (const name of missing) pendingCards.add(cardPoolKey(name));
      try {
        const fetched = await fetchCardCollection(missing.map((name) => ({ name })));
        set((state) => {
          const cards = { ...state.cards };
          for (const name of missing) {
            const card = fetched.get(scryfallCardKey(name));
            cards[cardPoolKey(name)] = card
              ? { legalities: card.legalities, oracleId: card.oracle_id }
              : null;
          }
          return { cards, error: null };
        });
      } catch (error) {
        set({ error: errorMessage(error) });
        return;
      } finally {
        for (const name of missing) pendingCards.delete(cardPoolKey(name));
      }
    }

    const withoutPrintings = [...new Set(commanderNames.map(cardPoolKey))].filter((key) => {
      const card = get().cards[key];
      return card && card.printedRarities === undefined && !pendingPrintings.has(key);
    });
    if (withoutPrintings.length === 0) return;
    for (const key of withoutPrintings) pendingPrintings.add(key);
    try {
      const printings = await fetchPrintsByOracleIds(
        withoutPrintings.map((key) => get().cards[key]!.oracleId),
      );
      set((state) => {
        const cards = { ...state.cards };
        for (const key of withoutPrintings) {
          const card = cards[key]!;
          const rarities = (printings.get(card.oracleId) ?? [])
            .filter(countsTowardRarity)
            .map((printing) => printing.rarity);
          cards[key] = { ...card, printedRarities: [...new Set(rarities)] };
        }
        return { cards, error: null };
      });
    } catch (error) {
      set({ error: errorMessage(error) });
    } finally {
      for (const key of withoutPrintings) pendingPrintings.delete(key);
    }
  },
}));
