import { create } from "zustand";
import {
  fetchDeckHubEntries,
  fetchDeckHubEntry,
  fetchDeckHubFacets,
  fetchDeckHubTags,
  fetchHubCapabilities,
  fetchTopDeckBuckets,
  fetchTopDeckSnapshot,
  setDeckHubFavorite,
  updateDeckHubEntry,
} from "@/api/hub";
import type { DeckHubEntryListParams } from "@/api/hub";
import type {
  DeckHubEntryDetail,
  DeckHubEntryList,
  DeckHubEntrySummary,
  DeckHubFacets,
  DeckHubTag,
  HubCapabilities,
  TopDeckBucket,
  TopDeckSnapshot,
  UpdateDeckHubEntryRequest,
} from "@/api/hubTypes";
import { useAuthStore } from "@/stores/useAuthStore";

interface HubState {
  myEntries: DeckHubEntryList | null;
  myEntriesLoading: boolean;
  myEntriesError: string | null;
  myEntriesAccountId: string | null;
  myEntriesFetchedAt: number | null;
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
  fetchMyEntries: (accountId: string, force?: boolean) => Promise<void>;
  clearMyEntries: () => void;
  removeEntry: (id: string) => void;
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

let myEntriesRequestId = 0;
let entryListRequestId = 0;
let topSnapshotRequestId = 0;
const entryRequests = new Map<string, Promise<DeckHubEntryDetail>>();
let capabilitiesRequest: Promise<HubCapabilities | null> | null = null;
const MY_ENTRIES_MAX_AGE_MS = 30_000;

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
  myEntries: null,
  myEntriesLoading: false,
  myEntriesError: null,
  myEntriesAccountId: null,
  myEntriesFetchedAt: null,
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
  fetchMyEntries: async (accountId, force = false) => {
    const state = get();
    if (state.myEntriesAccountId === accountId && state.myEntriesLoading) return;
    if (
      !force &&
      state.myEntriesAccountId === accountId &&
      state.myEntries !== null &&
      state.myEntriesFetchedAt !== null &&
      Date.now() - state.myEntriesFetchedAt < MY_ENTRIES_MAX_AGE_MS
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
  removeEntry: (id) =>
    set((state) => {
      const entryDetails = Object.fromEntries(
        Object.entries(state.entryDetails).filter(([, entry]) => entry.id !== id),
      );
      return {
        entryDetails,
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
