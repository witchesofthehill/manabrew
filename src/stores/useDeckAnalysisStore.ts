import { create } from "zustand";
import type { Deck } from "@/protocol/deck";
import { findMyCombos, type SpellbookCombo } from "@/api/commanderSpellbook";
import { fetchGameChangers, normalizeCardName } from "@/lib/gameChangers";
import { assessBracket, type BracketAssessment } from "@/lib/brackets";

interface DeckAnalysisState {
  included: SpellbookCombo[];
  almostIncluded: SpellbookCombo[];
  comboCardNames: Set<string>;
  gameChangerNames: Set<string>;
  bracket: BracketAssessment | null;
  loading: boolean;
  error: string | null;
  lastSignature: string | null;
  analyze: (deck: Deck) => Promise<void>;
  reset: () => void;
}

const EMPTY: Pick<
  DeckAnalysisState,
  "included" | "almostIncluded" | "comboCardNames" | "bracket" | "error"
> = {
  included: [],
  almostIncluded: [],
  comboCardNames: new Set(),
  bracket: null,
  error: null,
};

/** Stable identity of the cards that affect analysis — commander names, main
 *  deck names, and format. Lets the hook debounce and the store skip redundant
 *  network calls when an unrelated edit (cover art, tags) bumps the deck. */
export function deckAnalysisSignature(deck: Deck): string {
  const main = deck.cards.map((c) => c.name).sort();
  const commanders = (deck.commanders ?? []).map((c) => c.name).sort();
  return JSON.stringify([deck.format ?? "", commanders, main]);
}

export const useDeckAnalysisStore = create<DeckAnalysisState>((set, get) => ({
  ...EMPTY,
  gameChangerNames: new Set(),
  loading: false,
  lastSignature: null,
  analyze: async (deck) => {
    const signature = deckAnalysisSignature(deck);
    if (signature === get().lastSignature && !get().error) return;

    set({ loading: true, error: null, lastSignature: signature });

    const commanders = (deck.commanders ?? []).map((c) => c.name);
    const main = deck.cards.map((c) => c.name);

    try {
      const [gameChangers, combos] = await Promise.all([
        fetchGameChangers(),
        findMyCombos(commanders, main).catch((err) => {
          console.warn("[deck-analysis] combo lookup failed", err);
          return { identity: "", included: [], almostIncluded: [] };
        }),
      ]);

      if (get().lastSignature !== signature) return;

      const comboCardNames = new Set<string>();
      for (const combo of combos.included) {
        for (const use of combo.uses) comboCardNames.add(normalizeCardName(use.card.name));
      }

      set({
        loading: false,
        included: combos.included,
        almostIncluded: combos.almostIncluded,
        comboCardNames,
        gameChangerNames: gameChangers,
        bracket: assessBracket(deck, gameChangers, combos.included),
      });
    } catch (err) {
      if (get().lastSignature !== signature) return;
      console.warn("[deck-analysis] failed", err);
      set({
        loading: false,
        error: err instanceof Error ? err.message : "Deck analysis failed",
        lastSignature: null,
      });
    }
  },
  reset: () => set({ ...EMPTY, comboCardNames: new Set(), loading: false, lastSignature: null }),
}));

export function useIsComboCard(name: string): boolean {
  return useDeckAnalysisStore((s) => s.comboCardNames.has(normalizeCardName(name)));
}

export function useIsGameChangerCard(name: string): boolean {
  return useDeckAnalysisStore((s) => s.gameChangerNames.has(normalizeCardName(name)));
}
