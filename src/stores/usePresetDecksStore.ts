import { create } from "zustand";
import { useMemo } from "react";
import {
  expandPresetDeckDefinitions,
  loadPresetDeckDefinitions,
  presetSupportsEngine,
  type PresetDeck,
} from "@/lib/presetDecks";
import type { EngineKind } from "@/protocol";

interface PresetDecksState {
  decks: PresetDeck[];
  prefetch: () => Promise<void>;
}

let prefetchPromise: Promise<void> | null = null;

export const usePresetDecksStore = create<PresetDecksState>((set) => ({
  decks: [],
  prefetch: () => {
    if (prefetchPromise) return prefetchPromise;
    prefetchPromise = (async () => {
      try {
        const definitions = await loadPresetDeckDefinitions();
        set({ decks: expandPresetDeckDefinitions(definitions) });
      } catch (err) {
        if (import.meta.env?.DEV) {
          console.warn("[usePresetDecks] prefetch failed:", err);
        }
        prefetchPromise = null;
      }
    })();
    return prefetchPromise;
  },
}));

export function usePresetDecks(engine?: EngineKind): PresetDeck[] {
  const decks = usePresetDecksStore((s) => s.decks);
  if (!prefetchPromise) {
    void usePresetDecksStore.getState().prefetch();
  }
  return useMemo(
    () => (engine ? decks.filter((deck) => presetSupportsEngine(deck, engine)) : decks),
    [decks, engine],
  );
}

export function prefetchPresetDecks(): Promise<void> {
  return usePresetDecksStore.getState().prefetch();
}
