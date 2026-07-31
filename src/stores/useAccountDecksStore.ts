import { create } from "zustand";
import {
  createAccountDeck,
  deleteAccountDeck,
  fetchAccountDeck,
  fetchAccountDecks,
  fetchDeckVersions,
  saveAccountDeck,
} from "@/api/hub";
import type { AccountDeckDetail, AccountDeckSummary, DeckVersionSummary } from "@/api/hubTypes";
import type { EditorDeck } from "@/types/manabrew";

interface AccountDecksState {
  decks: AccountDeckSummary[];
  details: Record<string, AccountDeckDetail>;
  versions: Record<string, DeckVersionSummary[]>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  load: (id: string) => Promise<AccountDeckDetail>;
  create: (deck: EditorDeck, notes?: string) => Promise<AccountDeckDetail>;
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

function upsertSummary(
  summaries: AccountDeckSummary[],
  detail: AccountDeckDetail,
): AccountDeckSummary[] {
  const { deck: _deck, ...summary } = detail;
  return [summary, ...summaries.filter((candidate) => candidate.id !== detail.id)].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export const useAccountDecksStore = create<AccountDecksState>((set, get) => ({
  decks: [],
  details: {},
  versions: {},
  loading: false,
  error: null,
  refresh: async () => {
    const requestId = ++refreshRequestId;
    set({ loading: true, error: null });
    try {
      const result = await fetchAccountDecks();
      const details = await Promise.all(result.decks.map((deck) => fetchAccountDeck(deck.id)));
      if (requestId !== refreshRequestId) return;
      set({
        decks: result.decks,
        details: Object.fromEntries(details.map((detail) => [detail.id, detail])),
        loading: false,
      });
    } catch (error) {
      if (requestId !== refreshRequestId) return;
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to load account decks",
      });
    }
  },
  load: async (id) => {
    const cached = get().details[id];
    if (cached) return cached;
    const detail = await fetchAccountDeck(id);
    set((state) => ({
      decks: upsertSummary(state.decks, detail),
      details: { ...state.details, [id]: detail },
    }));
    return detail;
  },
  create: async (deck, notes) => {
    refreshRequestId += 1;
    set({ loading: false });
    const detail = await createAccountDeck({ deck, notes });
    set((state) => ({
      decks: upsertSummary(state.decks, detail),
      details: { ...state.details, [detail.id]: detail },
    }));
    return detail;
  },
  save: async (id, versionNo, deck, notes) => {
    refreshRequestId += 1;
    set({ loading: false });
    const detail = await saveAccountDeck(id, { deck, expectedVersionNo: versionNo, notes });
    set((state) => ({
      decks: upsertSummary(state.decks, detail),
      details: { ...state.details, [detail.id]: detail },
      versions: { ...state.versions, [id]: [] },
    }));
    return detail;
  },
  remove: async (id) => {
    refreshRequestId += 1;
    set({ loading: false });
    await deleteAccountDeck(id);
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
    const cached = get().versions[id];
    if (cached?.length) return cached;
    const versions = await fetchDeckVersions(id);
    set((state) => ({ versions: { ...state.versions, [id]: versions } }));
    return versions;
  },
  clear: () => {
    refreshRequestId += 1;
    set({ decks: [], details: {}, versions: {}, loading: false, error: null });
  },
}));
