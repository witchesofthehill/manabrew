import { create } from "zustand";
import {
  createAccountDeck,
  deleteAccountDeck,
  fetchAccountDeck,
  fetchAccountDecks,
  fetchDeckVersions,
  forkPresetDeck,
  saveAccountDeck,
} from "@/api/hub";
import type { AccountDeckDetail, AccountDeckSummary, DeckVersionSummary } from "@/api/hubTypes";
import { isFeatureEnabled } from "@/featureFlags";
import { useAuthStore } from "@/stores/useAuthStore";
import type { EditorDeck } from "@/types/manabrew";

interface AccountDecksState {
  accountId: string | null;
  decks: AccountDeckSummary[];
  details: Record<string, AccountDeckDetail>;
  versions: Record<string, DeckVersionSummary[]>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  load: (id: string) => Promise<AccountDeckDetail>;
  create: (deck: EditorDeck, notes?: string) => Promise<AccountDeckDetail>;
  forkPreset: (presetKey: string) => Promise<AccountDeckDetail>;
  save: (
    id: string,
    versionNo: number,
    deck: EditorDeck,
    notes?: string,
  ) => Promise<AccountDeckDetail>;
  remove: (id: string) => Promise<void>;
  loadVersions: (id: string) => Promise<DeckVersionSummary[]>;
  clear: () => void;
}

let refreshRequestId = 0;
let refreshRequest: Promise<void> | null = null;
const detailRequests = new Map<string, Promise<AccountDeckDetail>>();
const versionRequests = new Map<string, Promise<DeckVersionSummary[]>>();
const presetForkRequests = new Map<string, Promise<AccountDeckDetail>>();

function currentAccountId(): string | null {
  if (!isFeatureEnabled("accounts")) return null;
  return useAuthStore.getState().account?.id ?? null;
}

function requireAccountId(): string {
  const accountId = currentAccountId();
  if (!accountId) throw new Error("Sign in to use account decks.");
  return accountId;
}

function isCurrentAccount(accountId: string | null): boolean {
  return accountId === currentAccountId();
}

function upsertSummary(
  summaries: AccountDeckSummary[],
  detail: AccountDeckDetail,
): AccountDeckSummary[] {
  const { deck: _deck, ...summary } = detail;
  return [summary, ...summaries.filter((candidate) => candidate.id !== detail.id)].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

function cacheDetail(
  state: AccountDecksState,
  accountId: string | null,
  detail: AccountDeckDetail,
  invalidateVersions = false,
): Partial<AccountDecksState> {
  const sameAccount = state.accountId === accountId;
  return {
    accountId,
    decks: upsertSummary(sameAccount ? state.decks : [], detail),
    details: { ...(sameAccount ? state.details : {}), [detail.id]: detail },
    versions: {
      ...(sameAccount ? state.versions : {}),
      ...(invalidateVersions ? { [detail.id]: [] } : {}),
    },
  };
}

export const useAccountDecksStore = create<AccountDecksState>((set, get) => ({
  accountId: null,
  decks: [],
  details: {},
  versions: {},
  loading: false,
  error: null,
  refresh: async () => {
    const accountId = currentAccountId();
    if (!accountId) {
      get().clear();
      return;
    }
    if (get().accountId !== accountId) {
      refreshRequestId += 1;
      refreshRequest = null;
      detailRequests.clear();
      versionRequests.clear();
      presetForkRequests.clear();
      set({ accountId, decks: [], details: {}, versions: {}, loading: false, error: null });
    }
    if (refreshRequest) return refreshRequest;
    const requestId = ++refreshRequestId;
    set({ loading: true, error: null });
    const request = (async () => {
      try {
        const result = await fetchAccountDecks();
        const details = await Promise.all(result.decks.map((deck) => fetchAccountDeck(deck.id)));
        if (requestId !== refreshRequestId || !isCurrentAccount(accountId)) return;
        set({
          accountId,
          decks: result.decks,
          details: Object.fromEntries(details.map((detail) => [detail.id, detail])),
          loading: false,
        });
      } catch (error) {
        if (requestId !== refreshRequestId || !isCurrentAccount(accountId)) return;
        set({
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load account decks",
        });
      }
    })();
    refreshRequest = request;
    await request;
    if (refreshRequest === request) refreshRequest = null;
  },
  load: async (id) => {
    const accountId = requireAccountId();
    const cached = get().details[id];
    if (cached) return cached;
    const pending = detailRequests.get(id);
    if (pending) return pending;
    const requestId = refreshRequestId;
    const request = fetchAccountDeck(id)
      .then((detail) => {
        if (requestId === refreshRequestId && isCurrentAccount(accountId)) {
          set((state) => cacheDetail(state, accountId, detail));
        }
        return detail;
      })
      .finally(() => {
        if (detailRequests.get(id) === request) detailRequests.delete(id);
      });
    detailRequests.set(id, request);
    return request;
  },
  create: async (deck, notes) => {
    const accountId = requireAccountId();
    refreshRequestId += 1;
    refreshRequest = null;
    set({ loading: false });
    const detail = await createAccountDeck({ deck, notes });
    if (isCurrentAccount(accountId)) {
      set((state) => cacheDetail(state, accountId, detail));
    }
    return detail;
  },
  forkPreset: async (presetKey) => {
    const accountId = requireAccountId();
    const requestKey = `${accountId}:${presetKey.toLowerCase()}`;
    const pending = presetForkRequests.get(requestKey);
    if (pending) return pending;
    refreshRequestId += 1;
    refreshRequest = null;
    set({ loading: false });
    const request = forkPresetDeck(presetKey)
      .then((detail) => {
        if (isCurrentAccount(accountId)) {
          set((state) => cacheDetail(state, accountId, detail));
        }
        return detail;
      })
      .finally(() => {
        if (presetForkRequests.get(requestKey) === request) {
          presetForkRequests.delete(requestKey);
        }
      });
    presetForkRequests.set(requestKey, request);
    return request;
  },
  save: async (id, versionNo, deck, notes) => {
    const accountId = requireAccountId();
    refreshRequestId += 1;
    refreshRequest = null;
    detailRequests.delete(id);
    versionRequests.delete(id);
    set({ loading: false });
    const detail = await saveAccountDeck(id, { deck, expectedVersionNo: versionNo, notes });
    if (isCurrentAccount(accountId)) {
      set((state) => cacheDetail(state, accountId, detail, true));
    }
    return detail;
  },
  remove: async (id) => {
    const accountId = requireAccountId();
    refreshRequestId += 1;
    refreshRequest = null;
    detailRequests.delete(id);
    versionRequests.delete(id);
    set({ loading: false });
    await deleteAccountDeck(id);
    if (!isCurrentAccount(accountId)) return;
    set((state) => {
      const details = { ...state.details };
      const versions = { ...state.versions };
      delete details[id];
      delete versions[id];
      return {
        decks: state.decks.filter((deck) => deck.id !== id),
        details,
        versions,
      };
    });
  },
  loadVersions: async (id) => {
    const accountId = requireAccountId();
    const cached = get().versions[id];
    if (cached?.length) return cached;
    const pending = versionRequests.get(id);
    if (pending) return pending;
    const requestId = refreshRequestId;
    const request = fetchDeckVersions(id)
      .then((versions) => {
        if (requestId === refreshRequestId && isCurrentAccount(accountId)) {
          set((state) => ({ versions: { ...state.versions, [id]: versions } }));
        }
        return versions;
      })
      .finally(() => {
        if (versionRequests.get(id) === request) versionRequests.delete(id);
      });
    versionRequests.set(id, request);
    return request;
  },
  clear: () => {
    refreshRequestId += 1;
    refreshRequest = null;
    detailRequests.clear();
    versionRequests.clear();
    presetForkRequests.clear();
    set({ accountId: null, decks: [], details: {}, versions: {}, loading: false, error: null });
  },
}));
