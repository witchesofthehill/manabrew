import type { StateStorage } from "zustand/middleware";
import type { LimitedSavedSession } from "@/game/limitedPersistence.types";
import type { GauntletProgress, PendingGauntletMatch } from "@/lib/gauntletReturn";

const DATABASE = "manabrew-limited";
const VERSION = 1;
const SESSIONS_STORE = "sessions";
const STATE_STORE = "stores";
export const LIMITED_STORE_NAMES = {
  build: "manabrew-limited-builds",
  opening: "manabrew-limited-openings",
  limited: "manabrew-multiplayer-limited",
  draft: "manabrew-multiplayer-draft",
  gauntletProgress: "manabrew.gauntletProgress",
  pendingGauntletMatch: "manabrew.pendingGauntletMatch",
} satisfies Record<string, string>;
const listeners = new Set<() => void>();
let database: Promise<IDBDatabase> | null = null;
let writes: Promise<unknown> = Promise.resolve();

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SESSIONS_STORE, { keyPath: "sessionId" });
      request.result.createObjectStore(STATE_STORE);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      database = null;
      reject(new Error(`Limited saves could not be opened: ${request.error?.message}`));
    };
    request.onblocked = () =>
      reject(new Error("Close other Manabrew tabs to update Limited saves."));
  });
  return database;
}

async function transaction<T>(
  mode: IDBTransactionMode,
  action: (tx: IDBTransaction, result: (value: T) => void) => void,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction([SESSIONS_STORE, STATE_STORE], mode, {
      durability: mode === "readwrite" ? "strict" : "default",
    });
    let value: T;
    tx.oncomplete = () => {
      if (mode === "readwrite") listeners.forEach((listener) => listener());
      resolve(value);
    };
    tx.onerror = () => reject(new Error(`Limited save failed: ${tx.error?.message}`));
    tx.onabort = () => reject(new Error(`Limited save was not committed: ${tx.error?.message}`));
    try {
      action(tx, (result) => {
        value = result;
      });
    } catch (error) {
      tx.abort();
      reject(error);
    }
  });
}

export function subscribeLimitedSaves(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readLimitedSave(sessionId: string): Promise<LimitedSavedSession | null> {
  return transaction("readonly", (tx, result) => {
    const request = tx.objectStore(SESSIONS_STORE).get(sessionId);
    request.onsuccess = () => result(request.result ?? null);
  });
}

export function listLimitedSaves(): Promise<LimitedSavedSession[]> {
  return transaction("readonly", (tx, result) => {
    const request = tx.objectStore(SESSIONS_STORE).getAll();
    request.onsuccess = () =>
      result((request.result as LimitedSavedSession[]).sort((a, b) => b.updatedAt - a.updatedAt));
  });
}

export async function updateLimitedSave(
  sessionId: string,
  change: (previous: LimitedSavedSession | null) => LimitedSavedSession | null,
): Promise<LimitedSavedSession | null> {
  await writes;
  return transaction("readwrite", (tx, result) => {
    const store = tx.objectStore(SESSIONS_STORE);
    const request = store.get(sessionId);
    request.onsuccess = () => {
      try {
        const next = change(request.result ?? null);
        if (next) store.put(next);
        else store.delete(sessionId);
        result(next);
      } catch {
        tx.abort();
      }
    };
  });
}

export function flushLimitedStorage(): Promise<unknown> {
  return writes;
}

export const limitedStateStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => {
    localStorage.setItem(name, value);
    const next = writes
      .catch(() => {})
      .then(() =>
        transaction<void>("readwrite", (tx, result) => {
          tx.objectStore(STATE_STORE).put(value, name);
          if (name === LIMITED_STORE_NAMES.build || name === LIMITED_STORE_NAMES.opening) {
            const sessions = JSON.parse(value).state.sessions as Record<string, unknown>;
            for (const [sessionId, state] of Object.entries(sessions)) {
              const request = tx.objectStore(SESSIONS_STORE).get(sessionId);
              request.onsuccess = () => {
                const saved = request.result as LimitedSavedSession | undefined;
                if (!saved) return;
                tx.objectStore(SESSIONS_STORE).put({
                  ...saved,
                  [name === LIMITED_STORE_NAMES.build ? "build" : "opening"]: state,
                  updatedAt: Date.now(),
                });
              };
            }
          }
          if (name === LIMITED_STORE_NAMES.limited || name === LIMITED_STORE_NAMES.draft) {
            const peer = JSON.parse(value).state as {
              sessionId?: string;
              phase?: string;
              mode?: string;
            };
            if (peer.sessionId && peer.phase !== "idle" && peer.mode !== "idle") {
              const request = tx.objectStore(SESSIONS_STORE).get(peer.sessionId);
              request.onsuccess = () => {
                const saved = request.result as LimitedSavedSession | undefined;
                if (saved)
                  tx.objectStore(SESSIONS_STORE).put({
                    ...saved,
                    [name === LIMITED_STORE_NAMES.draft ? "draftPeer" : "peerSession"]: peer,
                    updatedAt: Date.now(),
                  });
              };
            }
          }
          if (name === LIMITED_STORE_NAMES.gauntletProgress) {
            const records = JSON.parse(value) as Record<string, GauntletProgress>;
            for (const [gauntletId, progress] of Object.entries(records)) {
              const request = tx.objectStore(SESSIONS_STORE).get(gauntletId);
              request.onsuccess = () => {
                const saved = request.result as LimitedSavedSession | undefined;
                if (!saved) return;
                const source = tx.objectStore(SESSIONS_STORE).get(progress.sessionKey);
                source.onsuccess = () =>
                  tx.objectStore(SESSIONS_STORE).put({
                    ...saved,
                    gauntletProgress: progress,
                    sourceSessionId: progress.sessionKey,
                    build: (source.result as LimitedSavedSession | undefined)?.build ?? saved.build,
                    setup: (source.result as LimitedSavedSession | undefined)?.setup ?? saved.setup,
                    updatedAt: Date.now(),
                  });
              };
            }
          } else if (name === LIMITED_STORE_NAMES.pendingGauntletMatch) {
            const marker = JSON.parse(value) as PendingGauntletMatch;
            const request = tx.objectStore(SESSIONS_STORE).get(marker.gauntletId);
            request.onsuccess = () => {
              const saved = request.result as LimitedSavedSession | undefined;
              if (saved)
                tx.objectStore(SESSIONS_STORE).put({
                  ...saved,
                  pendingGauntletMatch: marker,
                  updatedAt: Date.now(),
                });
            };
          }
          result(undefined);
        }),
      );
    writes = next;
    return next;
  },
  removeItem: (name) => {
    localStorage.removeItem(name);
    const next = writes
      .catch(() => {})
      .then(() =>
        transaction<void>("readwrite", (tx, result) => {
          tx.objectStore(STATE_STORE).delete(name);
          if (name === LIMITED_STORE_NAMES.pendingGauntletMatch) {
            const request = tx.objectStore(SESSIONS_STORE).getAll();
            request.onsuccess = () => {
              for (const saved of request.result as LimitedSavedSession[])
                if (saved.pendingGauntletMatch)
                  tx.objectStore(SESSIONS_STORE).put({ ...saved, pendingGauntletMatch: null });
            };
          }
          result(undefined);
        }),
      );
    writes = next;
    return next;
  },
};
