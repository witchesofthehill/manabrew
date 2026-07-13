import { create } from "zustand";
import { fetchHubDecks, fetchTopDecks } from "@/api/hub";
import type { HubListParams, TopDecksWindow } from "@/api/hub";
import type { HubDeckList, TopDeckStat } from "@/api/hubTypes";

interface HubState {
  list: HubDeckList | null;
  listError: string | null;
  topDecks: TopDeckStat[] | null;
  topError: string | null;
  fetchDecks: (params: HubListParams) => Promise<void>;
  fetchTop: (window: TopDecksWindow) => Promise<void>;
}

let listRequestId = 0;
let topRequestId = 0;

export const useHubStore = create<HubState>((set) => ({
  list: null,
  listError: null,
  topDecks: null,
  topError: null,
  fetchDecks: async (params) => {
    const requestId = ++listRequestId;
    try {
      const list = await fetchHubDecks(params);
      if (requestId === listRequestId) set({ list, listError: null });
    } catch (err) {
      if (requestId === listRequestId) {
        set({ listError: err instanceof Error ? err.message : "Failed to load the Deck Hub" });
      }
    }
  },
  fetchTop: async (window) => {
    const requestId = ++topRequestId;
    try {
      const topDecks = await fetchTopDecks(window);
      if (requestId === topRequestId) set({ topDecks, topError: null });
    } catch (err) {
      if (requestId === topRequestId) {
        set({ topError: err instanceof Error ? err.message : "Failed to load top decks" });
      }
    }
  },
}));
