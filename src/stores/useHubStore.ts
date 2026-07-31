import { create } from "zustand";
import {
  fetchDeckHubEntries,
  fetchDeckHubEntry,
  fetchDeckHubTags,
  fetchHubDeck,
  fetchHubCapabilities,
  fetchHubDecks,
  fetchMyDecks as fetchAccountDecks,
  fetchTopDeckBuckets,
  fetchTopDeckSnapshot,
  fetchTopDecks,
  setDeckHubFavorite,
} from "@/api/hub";
import type { DeckHubEntryListParams, HubListParams, TopDecksWindow } from "@/api/hub";
import type {
  DeckHubEntryDetail,
  DeckHubEntryList,
  DeckHubTag,
  HubCapabilities,
  HubDeckDetail,
  HubDeckList,
  TopDeckBucket,
  TopDeckSnapshot,
  TopDeckStat,
} from "@/api/hubTypes";
import { useAuthStore } from "@/stores/useAuthStore";

interface HubState {
  list: HubDeckList | null;
  listLoading: boolean;
  listError: string | null;
  topDecks: TopDeckStat[] | null;
  topError: string | null;
  myDecks: HubDeckList | null;
  myDecksLoading: boolean;
  myDecksError: string | null;
  myDecksAccountId: string | null;
  myDecksFetchedAt: number | null;
  details: Record<string, HubDeckDetail>;
  capabilities: HubCapabilities | null;
  capabilitiesLoaded: boolean;
  entries: DeckHubEntryList | null;
  entriesLoading: boolean;
  entriesError: string | null;
  entryDetails: Record<string, DeckHubEntryDetail>;
  tags: DeckHubTag[];
  topBuckets: TopDeckBucket[];
  topSnapshot: TopDeckSnapshot | null;
  topSnapshotError: string | null;
  fetchDecks: (params: HubListParams) => Promise<void>;
  fetchTop: (window: TopDecksWindow) => Promise<void>;
  fetchMyDecks: (accountId: string, force?: boolean) => Promise<void>;
  clearMyDecks: () => void;
  loadDeck: (id: string) => Promise<HubDeckDetail>;
  removeDeck: (id: string) => void;
  loadCapabilities: () => Promise<HubCapabilities | null>;
  fetchEntries: (params: DeckHubEntryListParams) => Promise<void>;
  loadEntry: (entryRef: string) => Promise<DeckHubEntryDetail>;
  fetchTags: () => Promise<void>;
  fetchTopBuckets: () => Promise<void>;
  fetchTopSnapshot: (bucket: string) => Promise<void>;
  setFavorite: (id: string, favorite: boolean) => Promise<void>;
}

let listRequestId = 0;
let topRequestId = 0;
let myDecksRequestId = 0;
let entryListRequestId = 0;
let topSnapshotRequestId = 0;
const detailRequests = new Map<string, Promise<HubDeckDetail>>();
const entryRequests = new Map<string, Promise<DeckHubEntryDetail>>();
const MY_DECKS_MAX_AGE_MS = 30_000;

export const useHubStore = create<HubState>((set, get) => ({
  list: null,
  listLoading: false,
  listError: null,
  topDecks: null,
  topError: null,
  myDecks: null,
  myDecksLoading: false,
  myDecksError: null,
  myDecksAccountId: null,
  myDecksFetchedAt: null,
  details: {},
  capabilities: null,
  capabilitiesLoaded: false,
  entries: null,
  entriesLoading: false,
  entriesError: null,
  entryDetails: {},
  tags: [],
  topBuckets: [],
  topSnapshot: null,
  topSnapshotError: null,
  fetchDecks: async (params) => {
    const requestId = ++listRequestId;
    set({ list: null, listLoading: true, listError: null });
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
    set({ topDecks: null, topError: null });
    try {
      const topDecks = await fetchTopDecks(window);
      if (requestId === topRequestId) set({ topDecks });
    } catch (err) {
      if (requestId === topRequestId) {
        set({
          topError: err instanceof Error ? err.message : "Failed to load top decks",
        });
      }
    }
  },
  fetchMyDecks: async (accountId, force = false) => {
    const state = get();
    if (state.myDecksAccountId === accountId && state.myDecksLoading) return;
    if (
      !force &&
      state.myDecksAccountId === accountId &&
      state.myDecks !== null &&
      state.myDecksFetchedAt !== null &&
      Date.now() - state.myDecksFetchedAt < MY_DECKS_MAX_AGE_MS
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
        set({ myDecks, myDecksLoading: false, myDecksFetchedAt: Date.now() });
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
      myDecksFetchedAt: null,
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
  removeDeck: (id) =>
    set((state) => {
      const details = { ...state.details };
      delete details[id];
      const entryDetails = Object.fromEntries(
        Object.entries(state.entryDetails).filter(([, entry]) => entry.id !== id),
      );
      const removeFromList = (list: HubDeckList | null) => {
        if (!list || !list.decks.some((deck) => deck.id === id)) return list;
        return {
          ...list,
          decks: list.decks.filter((deck) => deck.id !== id),
          total: Math.max(0, list.total - 1),
        };
      };
      return {
        details,
        entryDetails,
        list: removeFromList(state.list),
        myDecks: removeFromList(state.myDecks),
        entries: state.entries
          ? {
              ...state.entries,
              entries: state.entries.entries.filter((entry) => entry.id !== id),
              total: Math.max(
                0,
                state.entries.total -
                  Number(state.entries.entries.some((entry) => entry.id === id)),
              ),
            }
          : null,
        topSnapshot: state.topSnapshot
          ? {
              ...state.topSnapshot,
              entries: state.topSnapshot.entries.filter((entry) => entry.entry.id !== id),
            }
          : null,
      };
    }),
  loadCapabilities: async () => {
    const state = get();
    if (state.capabilitiesLoaded) return state.capabilities;
    const capabilities = await fetchHubCapabilities();
    set({ capabilities, capabilitiesLoaded: true });
    return capabilities;
  },
  fetchEntries: async (params) => {
    const requestId = ++entryListRequestId;
    set({ entriesLoading: true, entriesError: null });
    try {
      const entries = await fetchDeckHubEntries(params);
      if (requestId === entryListRequestId) set({ entries, entriesLoading: false });
    } catch (error) {
      if (requestId === entryListRequestId) {
        set({
          entriesLoading: false,
          entriesError: error instanceof Error ? error.message : "Failed to load the Deck Hub",
        });
      }
    }
  },
  loadEntry: async (entryRef) => {
    const viewer = useAuthStore.getState().account?.id ?? "anonymous";
    const cacheKey = `${viewer}:${entryRef}`;
    const cached = get().entryDetails[cacheKey];
    if (cached) return cached;
    const pending = entryRequests.get(cacheKey);
    if (pending) return pending;
    const request = fetchDeckHubEntry(entryRef)
      .then((detail) => {
        set((state) => ({
          entryDetails: {
            ...state.entryDetails,
            [cacheKey]: detail,
          },
        }));
        return detail;
      })
      .finally(() => entryRequests.delete(cacheKey));
    entryRequests.set(cacheKey, request);
    return request;
  },
  fetchTags: async () => {
    try {
      set({ tags: await fetchDeckHubTags() });
    } catch {
      set({ tags: [] });
    }
  },
  fetchTopBuckets: async () => {
    try {
      set({ topBuckets: await fetchTopDeckBuckets() });
    } catch {
      set({ topBuckets: [] });
    }
  },
  fetchTopSnapshot: async (bucket) => {
    const requestId = ++topSnapshotRequestId;
    set({ topSnapshot: null, topSnapshotError: null });
    try {
      const topSnapshot = await fetchTopDeckSnapshot(bucket);
      if (requestId === topSnapshotRequestId) set({ topSnapshot });
    } catch (error) {
      if (requestId === topSnapshotRequestId) {
        set({
          topSnapshotError: error instanceof Error ? error.message : "Failed to load this ranking",
        });
      }
    }
  },
  setFavorite: async (id, favorite) => {
    const viewerAccountId = useAuthStore.getState().account?.id ?? null;
    const viewerPrefix = `${viewerAccountId ?? "anonymous"}:`;
    const response = await setDeckHubFavorite(id, favorite);
    const viewerMatches = (useAuthStore.getState().account?.id ?? null) === viewerAccountId;
    set((state) => ({
      entries: state.entries
        ? {
            ...state.entries,
            entries: state.entries.entries.map((entry) =>
              entry.id === id
                ? {
                    ...entry,
                    favoriteCount: response.favoriteCount,
                    favorited: viewerMatches ? response.favorited : entry.favorited,
                  }
                : entry,
            ),
          }
        : null,
      entryDetails: Object.fromEntries(
        Object.entries(state.entryDetails).map(([key, entry]) => [
          key,
          entry.id === id
            ? {
                ...entry,
                favoriteCount: response.favoriteCount,
                favorited: key.startsWith(viewerPrefix) ? response.favorited : entry.favorited,
              }
            : entry,
        ]),
      ),
      topSnapshot: state.topSnapshot
        ? {
            ...state.topSnapshot,
            entries: state.topSnapshot.entries.map((ranked) =>
              ranked.entry.id === id
                ? {
                    ...ranked,
                    entry: {
                      ...ranked.entry,
                      favoriteCount: response.favoriteCount,
                      favorited: viewerMatches ? response.favorited : ranked.entry.favorited,
                    },
                  }
                : ranked,
            ),
          }
        : null,
    }));
  },
}));
