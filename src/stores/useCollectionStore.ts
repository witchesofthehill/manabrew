import { create } from "zustand";

import { fetchAccountCollection, saveAccountCollection } from "@/api/hub";
import { useAuthStore } from "@/stores/useAuthStore";

const LOCAL_COLLECTION_KEY = "manabrew-card-collection";
let accountSaveQueue = Promise.resolve();

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
  accountSaveQueue = accountSaveQueue
    .catch(() => undefined)
    .then(() => {
      if (useAuthStore.getState().account?.id !== accountId) return;
      return saveAccountCollection(toPayload(quantities));
    });
  return accountSaveQueue.catch(() => undefined);
}

interface CollectionState {
  accountId: string | null;
  quantities: Record<string, number>;
  loading: boolean;
  initialize: (accountId: string | null) => Promise<void>;
  setQuantity: (cardKey: string, quantity: number) => Promise<void>;
  replaceQuantities: (quantities: Record<string, number>) => Promise<void>;
}

export const useCollectionStore = create<CollectionState>((set, get) => ({
  accountId: null,
  quantities: {},
  loading: false,
  initialize: async (accountId) => {
    if (get().accountId === accountId && Object.keys(get().quantities).length > 0) return;
    if (!accountId) {
      set({ accountId: null, quantities: readLocalCollection(), loading: false });
      return;
    }
    set({ accountId, loading: true });
    try {
      const remote = await fetchAccountCollection();
      if (useAuthStore.getState().account?.id !== accountId) return;
      const quantities = Object.fromEntries(
        remote.cards.map((card) => [card.cardKey, card.quantity]),
      );
      const local = readLocalCollection();
      for (const [cardKey, quantity] of Object.entries(local)) {
        quantities[cardKey] = Math.max(quantities[cardKey] ?? 0, quantity);
      }
      if (Object.keys(local).length > 0) {
        await saveAccountCollection(toPayload(quantities));
        localStorage.removeItem(LOCAL_COLLECTION_KEY);
      }
      if (get().accountId === accountId) set({ quantities, loading: false });
    } catch {
      if (get().accountId === accountId) {
        set({ accountId: null, quantities: readLocalCollection(), loading: false });
      }
    }
  },
  setQuantity: async (cardKey, quantity) => {
    const normalized = cardKey.toLowerCase();
    const quantities = { ...get().quantities };
    if (quantity > 0) quantities[normalized] = Math.floor(quantity);
    else delete quantities[normalized];
    set({ quantities });
    const accountId = get().accountId;
    if (accountId) await queueAccountSave(accountId, quantities);
    else localStorage.setItem(LOCAL_COLLECTION_KEY, JSON.stringify(quantities));
  },
  replaceQuantities: async (quantities) => {
    const normalized = Object.fromEntries(
      Object.entries(quantities)
        .map(
          ([cardKey, quantity]) =>
            [cardKey.toLowerCase(), Math.max(0, Math.floor(quantity))] as const,
        )
        .filter(([, quantity]) => quantity > 0),
    );
    set({ quantities: normalized });
    const accountId = get().accountId;
    if (accountId) await queueAccountSave(accountId, normalized);
    else localStorage.setItem(LOCAL_COLLECTION_KEY, JSON.stringify(normalized));
  },
}));
