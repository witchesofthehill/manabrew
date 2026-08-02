import { create } from "zustand";
import {
  fetchDeckHubEntries,
  fetchDeckHubEntry,
  fetchDeckHubFacets,
  fetchDeckHubTags,
  fetchHubDeck,
  fetchHubCapabilities,
  fetchHubDecks,
  fetchMyDecks as fetchLegacyMyDecks,
  fetchTopDeckBuckets,
  fetchTopDeckSnapshot,
  setDeckHubFavorite,
  updateDeckHubEntry,
} from "@/api/hub";
import type { DeckHubEntryListParams, HubListParams } from "@/api/hub";
import type {
  DeckHubEntryDetail,
  DeckHubEntryList,
  DeckHubEntrySummary,
  DeckHubFacets,
  DeckHubTag,
  HubCapabilities,
  HubDeckDetail,
  HubDeckList,
  TopDeckBucket,
  TopDeckSnapshot,
  UpdateDeckHubEntryRequest,
} from "@/api/hubTypes";
import { useAuthStore } from "@/stores/useAuthStore";

interface HubState {
  list: HubDeckList | null;
  listLoading: boolean;
  listError: string | null;
  myDecks: HubDeckList | null;
  myDecksLoading: boolean;
  myDecksError: string | null;
  myDecksAccountId: string | null;
  myDecksFetchedAt: number | null;
  myEntries: DeckHubEntryList | null;
  myEntriesLoading: boolean;
  myEntriesError: string | null;
  myEntriesAccountId: string | null;
  myEntriesFetchedAt: number | null;
  details: Record<string, HubDeckDetail>;
  capabilities: HubCapabilities | null;
  capabilitiesLoaded: boolean;
  capabilitiesError: string | null;
  entries: DeckHubEntryList | null;
  entriesLoading: boolean;
  entriesError: string | null;
  entryDetails: Record<string, DeckHubEntryDetail>;
  tags: DeckHubTag[];
  facets: DeckHubFacets | null;
  topBuckets: TopDeckBucket[];
  topBucketsLoaded: boolean;
  topSnapshot: TopDeckSnapshot | null;
  topSnapshotError: string | null;
  favoritePending: Record<string, true>;
  fetchDecks: (params: HubListParams) => Promise<void>;
  fetchMyDecks: (accountId: string, force?: boolean) => Promise<void>;
  clearMyDecks: () => void;
  fetchMyEntries: (accountId: string, force?: boolean) => Promise<void>;
  clearMyEntries: () => void;
  loadDeck: (id: string) => Promise<HubDeckDetail>;
  loadPlayableDeck: (ref: string) => Promise<HubDeckDetail>;
  removeDeck: (id: string) => void;
  loadCapabilities: () => Promise<HubCapabilities | null>;
  fetchEntries: (params: DeckHubEntryListParams) => Promise<void>;
  loadEntry: (entryRef: string) => Promise<DeckHubEntryDetail>;
  fetchTags: () => Promise<void>;
  fetchFacets: () => Promise<void>;
  fetchTopBuckets: () => Promise<void>;
  fetchTopSnapshot: (bucket: string) => Promise<void>;
  setFavorite: (id: string, favorite: boolean) => Promise<void>;
  updateEntry: (id: string, request: UpdateDeckHubEntryRequest) => Promise<DeckHubEntryDetail>;
}

let listRequestId = 0;
let myDecksRequestId = 0;
let myEntriesRequestId = 0;
let entryListRequestId = 0;
let topSnapshotRequestId = 0;
const detailRequests = new Map<string, Promise<HubDeckDetail>>();
const entryRequests = new Map<string, Promise<DeckHubEntryDetail>>();
let capabilitiesRequest: Promise<HubCapabilities | null> | null = null;
const MY_DECKS_MAX_AGE_MS = 30_000;

function mapEntryList(
  list: DeckHubEntryList | null,
  id: string,
  update: (entry: DeckHubEntrySummary) => DeckHubEntrySummary,
): DeckHubEntryList | null {
  if (!list) return null;
  return {
    ...list,
    entries: list.entries.map((entry) => (entry.id === id ? update(entry) : entry)),
  };
}

function mapTopSnapshot(
  snapshot: TopDeckSnapshot | null,
  id: string,
  update: (entry: DeckHubEntrySummary) => DeckHubEntrySummary,
): TopDeckSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    entries: snapshot.entries.map((ranked) =>
      ranked.entry.id === id ? { ...ranked, entry: update(ranked.entry) } : ranked,
    ),
  };
}

function mapEntryDetails(
  details: Record<string, DeckHubEntryDetail>,
  id: string,
  update: (key: string, entry: DeckHubEntryDetail) => DeckHubEntryDetail,
): Record<string, DeckHubEntryDetail> {
  return Object.fromEntries(
    Object.entries(details).map(([key, entry]) => [
      key,
      entry.id === id ? update(key, entry) : entry,
    ]),
  );
}

export const useHubStore = create<HubState>((set, get) => ({
  list: null,
  listLoading: false,
  listError: null,
  myDecks: null,
  myDecksLoading: false,
  myDecksError: null,
  myDecksAccountId: null,
  myDecksFetchedAt: null,
  myEntries: null,
  myEntriesLoading: false,
  myEntriesError: null,
  myEntriesAccountId: null,
  myEntriesFetchedAt: null,
  details: {},
  capabilities: null,
  capabilitiesLoaded: false,
  capabilitiesError: null,
  entries: null,
  entriesLoading: false,
  entriesError: null,
  entryDetails: {},
  tags: [],
  facets: null,
  topBuckets: [],
  topBucketsLoaded: false,
  topSnapshot: null,
  topSnapshotError: null,
  favoritePending: {},
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
          listError: err instanceof Error ? err.message : "Failed to load Community",
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
      const myDecks = await fetchLegacyMyDecks();
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
  fetchMyEntries: async (accountId, force = false) => {
    const state = get();
    if (state.myEntriesAccountId === accountId && state.myEntriesLoading) return;
    if (
      !force &&
      state.myEntriesAccountId === accountId &&
      state.myEntries !== null &&
      state.myEntriesFetchedAt !== null &&
      Date.now() - state.myEntriesFetchedAt < MY_DECKS_MAX_AGE_MS
    )
      return;
    const requestId = ++myEntriesRequestId;
    set({
      myEntriesLoading: true,
      myEntriesError: null,
      myEntriesAccountId: accountId,
      ...(state.myEntriesAccountId === accountId ? {} : { myEntries: null }),
    });
    try {
      const entries: DeckHubEntrySummary[] = [];
      let page = 1;
      let result: DeckHubEntryList;
      do {
        result = await fetchDeckHubEntries({ owned: true, page, pageSize: 50 });
        if (result.entries.length === 0) break;
        entries.push(...result.entries);
        page += 1;
      } while (entries.length < result.total);
      if (requestId === myEntriesRequestId && get().myEntriesAccountId === accountId) {
        set({
          myEntries: {
            ...result,
            entries,
            total: entries.length,
            page: 1,
            pageSize: result.pageSize,
          },
          myEntriesLoading: false,
          myEntriesFetchedAt: Date.now(),
        });
      }
    } catch (error) {
      if (requestId === myEntriesRequestId && get().myEntriesAccountId === accountId) {
        set({
          myEntriesLoading: false,
          myEntriesError:
            error instanceof Error ? error.message : "Failed to load your publications",
        });
      }
    }
  },
  clearMyEntries: () => {
    myEntriesRequestId += 1;
    set({
      myEntries: null,
      myEntriesLoading: false,
      myEntriesError: null,
      myEntriesAccountId: null,
      myEntriesFetchedAt: null,
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
  loadPlayableDeck: async (ref) => {
    const capabilities = get().capabilitiesLoaded
      ? get().capabilities
      : await get().loadCapabilities();
    if (capabilities?.domainVersion !== 2) return get().loadDeck(ref);
    const entry = await get().loadEntry(ref);
    return {
      id: entry.id,
      name: entry.title,
      author: entry.author,
      description: entry.summary,
      format: entry.format,
      commanders: entry.commanders,
      colors: entry.colors,
      cardCount: entry.cardCount,
      coverCardName: entry.coverCardName,
      coverImageUrl: entry.coverImageUrl,
      createdAt: entry.publishedAt,
      deck: entry.deck,
    };
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
        myEntries: state.myEntries
          ? {
              ...state.myEntries,
              entries: state.myEntries.entries.filter((entry) => entry.id !== id),
              total: Math.max(
                0,
                state.myEntries.total -
                  Number(state.myEntries.entries.some((entry) => entry.id === id)),
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
    if (capabilitiesRequest) return capabilitiesRequest;
    set({ capabilitiesError: null });
    const request: Promise<HubCapabilities | null> = fetchHubCapabilities()
      .then((capabilities) => {
        set({ capabilities, capabilitiesLoaded: true, capabilitiesError: null });
        return capabilities;
      })
      .catch((error) => {
        set({
          capabilitiesError: error instanceof Error ? error.message : "Could not reach Community",
        });
        return null;
      })
      .finally(() => {
        if (capabilitiesRequest === request) capabilitiesRequest = null;
      });
    capabilitiesRequest = request;
    return request;
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
          entriesError: error instanceof Error ? error.message : "Failed to load Community",
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
  fetchFacets: async () => {
    try {
      set({ facets: await fetchDeckHubFacets() });
    } catch {
      set({ facets: null });
    }
  },
  fetchTopBuckets: async () => {
    try {
      set({ topBuckets: await fetchTopDeckBuckets(), topBucketsLoaded: true });
    } catch {
      set({ topBuckets: [], topBucketsLoaded: true });
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
    if (get().favoritePending[id]) return;
    set((state) => ({ favoritePending: { ...state.favoritePending, [id]: true } }));
    try {
      const viewerAccountId = useAuthStore.getState().account?.id ?? null;
      const viewerPrefix = `${viewerAccountId ?? "anonymous"}:`;
      const response = await setDeckHubFavorite(id, favorite);
      const viewerMatches = (useAuthStore.getState().account?.id ?? null) === viewerAccountId;
      const update = (entry: DeckHubEntrySummary) => ({
        ...entry,
        favoriteCount: response.favoriteCount,
        favorited: viewerMatches ? response.favorited : entry.favorited,
      });
      set((state) => ({
        entries: mapEntryList(state.entries, id, update),
        myEntries: mapEntryList(state.myEntries, id, update),
        entryDetails: mapEntryDetails(state.entryDetails, id, (key, entry) => ({
          ...entry,
          favoriteCount: response.favoriteCount,
          favorited: key.startsWith(viewerPrefix) ? response.favorited : entry.favorited,
        })),
        topSnapshot: mapTopSnapshot(state.topSnapshot, id, update),
      }));
    } finally {
      set((state) => {
        const favoritePending = { ...state.favoritePending };
        delete favoritePending[id];
        return { favoritePending };
      });
    }
  },
  updateEntry: async (id, request) => {
    const updated = await updateDeckHubEntry(id, request);
    const { deck: _deck, ...summary } = updated;
    set((state) => ({
      entries: mapEntryList(state.entries, id, () => summary),
      myEntries: mapEntryList(state.myEntries, id, () => summary),
      entryDetails: mapEntryDetails(state.entryDetails, id, () => updated),
      topSnapshot: mapTopSnapshot(state.topSnapshot, id, () => summary),
    }));
    return updated;
  },
}));
