import { create } from "zustand";

import { fetchAccountCollection, HubRequestError, saveAccountCollection } from "@/api/hub";
import { useAuthStore } from "@/stores/useAuthStore";

const LOCAL_COLLECTION_KEY = "manabrew-card-collection";
const PENDING_ACCOUNT_COLLECTION_KEY = "manabrew-pending-account-collection";
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

function toPayload(quantities: Record<string, number>, version: number) {
  return {
    version,
    cards: Object.entries(quantities).map(([cardKey, quantity]) => ({ cardKey, quantity })),
  };
}

interface PendingAccountCollection {
  quantities: Record<string, number>;
  syncedQuantities?: Record<string, number>;
}

function readPendingAccountCollections(): Record<string, PendingAccountCollection> {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_ACCOUNT_COLLECTION_KEY) ?? "{}") as {
      accountId?: string;
      quantities?: Record<string, number>;
      syncedQuantities?: Record<string, number>;
      [accountId: string]: unknown;
    };
    if (parsed.accountId && parsed.quantities) {
      return {
        [parsed.accountId]: {
          quantities: parsed.quantities,
          syncedQuantities: parsed.syncedQuantities,
        },
      };
    }
    return parsed as Record<string, PendingAccountCollection>;
  } catch {
    return {};
  }
}

function writePendingAccountCollection(
  accountId: string,
  quantities: Record<string, number>,
  syncedQuantities?: Record<string, number>,
) {
  const pending = readPendingAccountCollections();
  pending[accountId] = { quantities, syncedQuantities };
  localStorage.setItem(PENDING_ACCOUNT_COLLECTION_KEY, JSON.stringify(pending));
}

function readPendingAccountCollection(accountId: string): PendingAccountCollection | null {
  return readPendingAccountCollections()[accountId] ?? null;
}

function clearPendingAccountCollection(accountId: string) {
  const pending = readPendingAccountCollections();
  delete pending[accountId];
  if (Object.keys(pending).length > 0) {
    localStorage.setItem(PENDING_ACCOUNT_COLLECTION_KEY, JSON.stringify(pending));
  } else {
    localStorage.removeItem(PENDING_ACCOUNT_COLLECTION_KEY);
  }
}

function applyCollectionDelta(
  base: Record<string, number>,
  desired: Record<string, number>,
  remote: Record<string, number>,
): Record<string, number> {
  const merged = { ...remote };
  for (const cardKey of new Set([...Object.keys(base), ...Object.keys(desired)])) {
    if ((base[cardKey] ?? 0) === (desired[cardKey] ?? 0)) continue;
    if ((desired[cardKey] ?? 0) > 0) merged[cardKey] = desired[cardKey];
    else delete merged[cardKey];
  }
  return merged;
}

function queueAccountSave(
  accountId: string,
  quantities: Record<string, number>,
  baseQuantities: Record<string, number>,
): Promise<void> {
  const request = accountSaveQueue
    .catch(() => undefined)
    .then(() => {
      if (useAuthStore.getState().account?.id !== accountId) {
        writePendingAccountCollection(accountId, quantities, baseQuantities);
        throw new Error("Collection account changed before this edit could sync");
      }
      const state = useCollectionStore.getState();
      let pending = quantities;
      let pendingBase = baseQuantities;
      const save = async () => {
        let desired = pending;
        let version = state.version;
        try {
          const saved = await saveAccountCollection(toPayload(desired, version));
          version = saved.version ?? version + 1;
        } catch (error) {
          if (!(error instanceof HubRequestError) || error.status !== 409) throw error;
          const remote = await fetchAccountCollection();
          const remoteQuantities = Object.fromEntries(
            remote.cards.map((card) => [card.cardKey, card.quantity]),
          );
          desired = applyCollectionDelta(state.syncedQuantities, desired, remoteQuantities);
          pending = desired;
          pendingBase = remoteQuantities;
          version = remote.version ?? 0;
          const saved = await saveAccountCollection(toPayload(desired, version));
          version = saved.version ?? version + 1;
        }
        if (useCollectionStore.getState().accountId === accountId) {
          clearPendingAccountCollection(accountId);
          useCollectionStore.setState({
            version,
            quantities: desired,
            syncedQuantities: desired,
            error: null,
          });
        }
      };
      return save().catch((error) => {
        writePendingAccountCollection(accountId, pending, pendingBase);
        throw error;
      });
    });
  accountSaveQueue = request;
  return request;
}

interface CollectionState {
  accountId: string | null;
  version: number;
  quantities: Record<string, number>;
  syncedQuantities: Record<string, number>;
  loading: boolean;
  error: string | null;
  initialize: (accountId: string | null) => Promise<void>;
  setQuantity: (cardKey: string, quantity: number) => Promise<void>;
  mergeQuantities: (quantities: Record<string, number>) => Promise<void>;
  replaceQuantities: (quantities: Record<string, number>) => Promise<void>;
}

export const useCollectionStore = create<CollectionState>((set, get) => ({
  accountId: null,
  version: 0,
  quantities: {},
  syncedQuantities: {},
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
      set({
        accountId: null,
        version: 0,
        quantities: readLocalCollection(),
        syncedQuantities: {},
        loading: false,
        error: null,
      });
      return;
    }
    const initializationId = ++collectionInitializationId;
    const local = readLocalCollection();
    const pendingAccountCollection = readPendingAccountCollection(accountId);
    const quantitiesWhileLoading = get().accountId === null ? local : {};
    set({
      accountId,
      version: 0,
      quantities: quantitiesWhileLoading,
      syncedQuantities: {},
      loading: true,
      error: null,
    });
    const initialize = async () => {
      try {
        const remote = await fetchAccountCollection();
        if (
          initializationId !== collectionInitializationId ||
          useAuthStore.getState().account?.id !== accountId
        ) {
          return;
        }
        const remoteQuantities = Object.fromEntries(
          remote.cards.map((card) => [card.cardKey, card.quantity]),
        );
        let quantities = { ...remoteQuantities };
        if (pendingAccountCollection) {
          quantities = pendingAccountCollection.syncedQuantities
            ? applyCollectionDelta(
                pendingAccountCollection.syncedQuantities,
                pendingAccountCollection.quantities,
                remoteQuantities,
              )
            : { ...pendingAccountCollection.quantities };
        } else {
          for (const [cardKey, quantity] of Object.entries(local)) {
            quantities[cardKey] = Math.max(quantities[cardKey] ?? 0, quantity);
          }
        }
        if (pendingAccountCollection || Object.keys(local).length > 0) {
          let version = remote.version ?? 0;
          try {
            const saved = await saveAccountCollection(toPayload(quantities, version));
            version = saved.version ?? version + 1;
          } catch (error) {
            if (!(error instanceof HubRequestError) || error.status !== 409) throw error;
            const latest = await fetchAccountCollection();
            const latestQuantities = Object.fromEntries(
              latest.cards.map((card) => [card.cardKey, card.quantity]),
            );
            if (pendingAccountCollection?.syncedQuantities) {
              quantities = applyCollectionDelta(
                pendingAccountCollection.syncedQuantities,
                quantities,
                latestQuantities,
              );
            } else if (!pendingAccountCollection) {
              quantities = applyCollectionDelta(remoteQuantities, quantities, latestQuantities);
            }
            version = latest.version ?? 0;
            const saved = await saveAccountCollection(toPayload(quantities, version));
            version = saved.version ?? version + 1;
          }
          remote.version = version;
          if (
            initializationId !== collectionInitializationId ||
            useAuthStore.getState().account?.id !== accountId
          ) {
            return;
          }
          localStorage.removeItem(LOCAL_COLLECTION_KEY);
          clearPendingAccountCollection(accountId);
        }
        if (get().accountId === accountId) {
          set({
            version: remote.version ?? 0,
            quantities,
            syncedQuantities: quantities,
            loading: false,
            error: null,
          });
        }
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
    const normalized = cardKey.toLowerCase();
    const pendingQuantities = { ...get().quantities };
    if (quantity > 0) pendingQuantities[normalized] = Math.floor(quantity);
    else delete pendingQuantities[normalized];
    const pendingBaseQuantities = get().syncedQuantities;
    await collectionInitialization;
    if (get().accountId !== intendedAccountId) {
      if (intendedAccountId) {
        writePendingAccountCollection(intendedAccountId, pendingQuantities, pendingBaseQuantities);
      } else localStorage.setItem(LOCAL_COLLECTION_KEY, JSON.stringify(pendingQuantities));
      throw new Error("Collection account changed before this edit could be applied");
    }
    const baseQuantities = get().syncedQuantities;
    const quantities = { ...get().quantities };
    if (quantity > 0) quantities[normalized] = Math.floor(quantity);
    else delete quantities[normalized];
    set({ quantities });
    const accountId = intendedAccountId;
    if (accountId) {
      try {
        await queueAccountSave(accountId, quantities, baseQuantities);
        if (get().accountId === accountId) {
          localStorage.removeItem(LOCAL_COLLECTION_KEY);
          clearPendingAccountCollection(accountId);
          set({ error: null });
        }
      } catch (error) {
        if (get().accountId === accountId) {
          set({ error: error instanceof Error ? error.message : "Collection sync failed" });
        }
        throw error;
      }
    } else localStorage.setItem(LOCAL_COLLECTION_KEY, JSON.stringify(quantities));
  },
  mergeQuantities: async (imported) => {
    const intendedAccountId = get().accountId;
    await collectionInitialization;
    if (get().accountId !== intendedAccountId) {
      throw new Error("Collection account changed before this import could be applied");
    }
    const baseQuantities = get().syncedQuantities;
    const quantities = { ...get().quantities };
    for (const [cardKey, quantity] of Object.entries(imported)) {
      const normalized = cardKey.toLowerCase();
      const amount = Math.max(0, Math.floor(quantity));
      if (amount > 0) quantities[normalized] = (quantities[normalized] ?? 0) + amount;
    }
    set({ quantities });
    const accountId = intendedAccountId;
    if (accountId) {
      try {
        await queueAccountSave(accountId, quantities, baseQuantities);
        if (get().accountId === accountId) {
          localStorage.removeItem(LOCAL_COLLECTION_KEY);
          clearPendingAccountCollection(accountId);
          set({ error: null });
        }
      } catch (error) {
        if (get().accountId === accountId) {
          set({ error: error instanceof Error ? error.message : "Collection sync failed" });
        }
        throw error;
      }
    } else localStorage.setItem(LOCAL_COLLECTION_KEY, JSON.stringify(quantities));
  },
  replaceQuantities: async (quantities) => {
    const intendedAccountId = get().accountId;
    const baseQuantities = get().syncedQuantities;
    const normalized = Object.fromEntries(
      Object.entries(quantities)
        .map(
          ([cardKey, quantity]) =>
            [cardKey.toLowerCase(), Math.max(0, Math.floor(quantity))] as const,
        )
        .filter(([, quantity]) => quantity > 0),
    );
    await collectionInitialization;
    if (get().accountId !== intendedAccountId) {
      if (intendedAccountId) {
        writePendingAccountCollection(intendedAccountId, normalized, baseQuantities);
      } else localStorage.setItem(LOCAL_COLLECTION_KEY, JSON.stringify(normalized));
      throw new Error("Collection account changed before this import could be applied");
    }
    set({ quantities: normalized });
    const accountId = intendedAccountId;
    if (accountId) {
      try {
        await queueAccountSave(accountId, normalized, baseQuantities);
        if (get().accountId === accountId) {
          localStorage.removeItem(LOCAL_COLLECTION_KEY);
          clearPendingAccountCollection(accountId);
          set({ error: null });
        }
      } catch (error) {
        if (get().accountId === accountId) {
          set({ error: error instanceof Error ? error.message : "Collection sync failed" });
        }
        throw error;
      }
    } else localStorage.setItem(LOCAL_COLLECTION_KEY, JSON.stringify(normalized));
  },
}));
