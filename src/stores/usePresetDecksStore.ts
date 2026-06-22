import { create } from "zustand";
import { getDefaultGameRuntime } from "@/game/runtimeRegistry";
import type { Deck } from "@/protocol/deck";

interface PresetDecksState {
  decks: Deck[];
  prefetch: () => Promise<void>;
}

let prefetchPromise: Promise<void> | null = null;

export const usePresetDecksStore = create<PresetDecksState>((set) => ({
  decks: [],
  prefetch: () => {
    if (prefetchPromise) return prefetchPromise;
    prefetchPromise = (async () => {
      try {
        const presets = await getDefaultGameRuntime().api.getPresetDecks();
        set({ decks: presets });
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

export function usePresetDecks(): Deck[] {
  const decks = usePresetDecksStore((s) => s.decks);
  if (!prefetchPromise) {
    void usePresetDecksStore.getState().prefetch();
  }
  return decks;
}

export function prefetchPresetDecks(): Promise<void> {
  return usePresetDecksStore.getState().prefetch();
}
