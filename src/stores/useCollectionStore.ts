import { create } from "zustand";

import { fetchAccountCollection, saveAccountCollection } from "@/api/hub";
import { useAuthStore } from "@/stores/useAuthStore";

const LOCAL_COLLECTION_KEY = "manabrew-card-collection";
let accountSaveQueue = Promise.resolve();
let collectionInitialization = Promise.resolve();
let collectionInitializationId = 0;

function readLocalCollection(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_COLLECTION_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function toPayload(quantities: Record<string, number>) {
  return {
    cards: Object.entries(quantities).map(([cardKey, quantity]) => ({ cardKey, quantity })),
  };
}

function queueAccountSave(accountId: string, quantities: Record<string, number>): Promise<void> {
  const request = accountSaveQueue
    .catch(() => undefined)
    .then(() => {
      if (useAuthStore.getState().account?.id !== accountId) return;
      return saveAccountCollection(toPayload(quantities));
    });
  accountSaveQueue = request;
  return request;
}

interface CollectionState {
  accountId: string | null;
  quantities: Record<string, number>;
  loading: boolean;
  error: string | null;
  initialize: (accountId: string | null) => Promise<void>;
  setQuantity: (cardKey: string, quantity: number) => Promise<void>;
  replaceQuantities: (quantities: Record<string, number>) => Promise<void>;
}

export const useCollectionStore = create<CollectionState>((set, get) => ({
  accountId: null,
  quantities: {},
  loading: false,
  error: null,
  initialize: async (accountId) => {
    if (get().accountId === accountId && get().loading) {
      await collectionInitialization;
      return;
    }
    if (get().accountId === accountId && !get().error && Object.keys(get().quantities).length > 0) {
      return;
    }
    if (!accountId) {
      collectionInitializationId += 1;
      set({ accountId: null, quantities: readLocalCollection(), loading: false, error: null });
      return;
    }
    const initializationId = ++collectionInitializationId;
    const local = readLocalCollection();
    const quantitiesWhileLoading = get().accountId === null ? local : {};
    set({ accountId, quantities: quantitiesWhileLoading, loading: true, error: null });
    const initialize = async () => {
      try {
        const remote = await fetchAccountCollection();
        if (
          initializationId !== collectionInitializationId ||
          useAuthStore.getState().account?.id !== accountId
        ) {
          return;
        }
        const quantities = Object.fromEntries(
          remote.cards.map((card) => [card.cardKey, card.quantity]),
        );
        for (const [cardKey, quantity] of Object.entries(local)) {
          quantities[cardKey] = Math.max(quantities[cardKey] ?? 0, quantity);
        }
        if (Object.keys(local).length > 0) {
          await saveAccountCollection(toPayload(quantities));
          if (
            initializationId !== collectionInitializationId ||
            useAuthStore.getState().account?.id !== accountId
          ) {
            return;
          }
          localStorage.removeItem(LOCAL_COLLECTION_KEY);
        }
        if (get().accountId === accountId) set({ quantities, loading: false, error: null });
      } catch (error) {
        if (initializationId === collectionInitializationId && get().accountId === accountId) {
          set({
            loading: false,
            error: error instanceof Error ? error.message : "Collection sync failed",
          });
        }
      }
    };
    const pending = initialize();
    collectionInitialization = pending.catch(() => undefined);
    await pending;
  },
  setQuantity: async (cardKey, quantity) => {
    const intendedAccountId = get().accountId;
    await collectionInitialization;
    if (get().accountId !== intendedAccountId) return;
    const normalized = cardKey.toLowerCase();
    const quantities = { ...get().quantities };
    if (quantity > 0) quantities[normalized] = Math.floor(quantity);
    else delete quantities[normalized];
    set({ quantities });
    const accountId = intendedAccountId;
    if (accountId) {
      try {
        await queueAccountSave(accountId, quantities);
        if (get().accountId === accountId) {
          localStorage.removeItem(LOCAL_COLLECTION_KEY);
          set({ error: null });
        }
      } catch (error) {
        if (get().accountId === accountId) {
          localStorage.setItem(LOCAL_COLLECTION_KEY, JSON.stringify(quantities));
          set({ error: error instanceof Error ? error.message : "Collection sync failed" });
        }
        throw error;
      }
    } else localStorage.setItem(LOCAL_COLLECTION_KEY, JSON.stringify(quantities));
  },
  replaceQuantities: async (quantities) => {
    const intendedAccountId = get().accountId;
    await collectionInitialization;
    if (get().accountId !== intendedAccountId) return;
    const normalized = Object.fromEntries(
      Object.entries(quantities)
        .map(
          ([cardKey, quantity]) =>
            [cardKey.toLowerCase(), Math.max(0, Math.floor(quantity))] as const,
        )
        .filter(([, quantity]) => quantity > 0),
    );
    set({ quantities: normalized });
    const accountId = intendedAccountId;
    if (accountId) {
      try {
        await queueAccountSave(accountId, normalized);
        if (get().accountId === accountId) {
          localStorage.removeItem(LOCAL_COLLECTION_KEY);
          set({ error: null });
        }
      } catch (error) {
        if (get().accountId === accountId) {
          localStorage.setItem(LOCAL_COLLECTION_KEY, JSON.stringify(normalized));
          set({ error: error instanceof Error ? error.message : "Collection sync failed" });
        }
        throw error;
      }
    } else localStorage.setItem(LOCAL_COLLECTION_KEY, JSON.stringify(normalized));
  },
}));
