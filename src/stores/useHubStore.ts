import { create } from "zustand";
import {
  fetchHubDeck,
  fetchHubDecks,
  fetchMyDecks as fetchAccountDecks,
  fetchTopDecks,
} from "@/api/hub";
import type { HubListParams, TopDecksWindow } from "@/api/hub";
import type { HubDeckDetail, HubDeckList, TopDeckStat } from "@/api/hubTypes";

interface HubState {
  list: HubDeckList | null;
  listLoading: boolean;
  listError: string | null;
  topDecks: TopDeckStat[] | null;
  topLoading: boolean;
  topError: string | null;
  myDecks: HubDeckList | null;
  myDecksLoading: boolean;
  myDecksError: string | null;
  myDecksAccountId: string | null;
  details: Record<string, HubDeckDetail>;
  fetchDecks: (params: HubListParams) => Promise<void>;
  fetchTop: (window: TopDecksWindow) => Promise<void>;
  fetchMyDecks: (accountId: string, force?: boolean) => Promise<void>;
  clearMyDecks: () => void;
  loadDeck: (id: string) => Promise<HubDeckDetail>;
}

let listRequestId = 0;
let topRequestId = 0;
let myDecksRequestId = 0;
const detailRequests = new Map<string, Promise<HubDeckDetail>>();

export const useHubStore = create<HubState>((set, get) => ({
  list: null,
  listLoading: false,
  listError: null,
  topDecks: null,
  topLoading: false,
  topError: null,
  myDecks: null,
  myDecksLoading: false,
  myDecksError: null,
  myDecksAccountId: null,
  details: {},
  fetchDecks: async (params) => {
    const requestId = ++listRequestId;
    set({ listLoading: true, listError: null });
    try {
      const list = await fetchHubDecks(params);
      if (requestId === listRequestId) set({ list, listLoading: false });
    } catch (err) {
      if (requestId === listRequestId) {
        set({
          listLoading: false,
          listError: err instanceof Error ? err.message : "Failed to load the Deck Hub",
        });
      }
    }
  },
  fetchTop: async (window) => {
    const requestId = ++topRequestId;
    set({ topLoading: true, topError: null });
    try {
      const topDecks = await fetchTopDecks(window);
      if (requestId === topRequestId) set({ topDecks, topLoading: false });
    } catch (err) {
      if (requestId === topRequestId) {
        set({
          topLoading: false,
          topError: err instanceof Error ? err.message : "Failed to load top decks",
        });
      }
    }
  },
  fetchMyDecks: async (accountId, force = false) => {
    const state = get();
    if (
      !force &&
      state.myDecksAccountId === accountId &&
      (state.myDecks !== null || state.myDecksLoading)
    )
      return;
    const requestId = ++myDecksRequestId;
    set({
      myDecksLoading: true,
      myDecksError: null,
      myDecksAccountId: accountId,
      ...(state.myDecksAccountId === accountId ? {} : { myDecks: null }),
    });
    try {
      const myDecks = await fetchAccountDecks();
      if (requestId === myDecksRequestId && get().myDecksAccountId === accountId) {
        set({ myDecks, myDecksLoading: false });
      }
    } catch (err) {
      if (requestId === myDecksRequestId && get().myDecksAccountId === accountId) {
        set({
          myDecksLoading: false,
          myDecksError: err instanceof Error ? err.message : "Failed to load your published decks",
        });
      }
    }
  },
  clearMyDecks: () => {
    myDecksRequestId += 1;
    set({
      myDecks: null,
      myDecksLoading: false,
      myDecksError: null,
      myDecksAccountId: null,
    });
  },
  loadDeck: async (id) => {
    const cached = get().details[id];
    if (cached) return cached;
    const pending = detailRequests.get(id);
    if (pending) return pending;
    const request = fetchHubDeck(id)
      .then((detail) => {
        set((state) => ({ details: { ...state.details, [id]: detail } }));
        return detail;
      })
      .finally(() => detailRequests.delete(id));
    detailRequests.set(id, request);
    return request;
  },
}));
