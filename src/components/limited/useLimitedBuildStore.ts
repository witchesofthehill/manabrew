import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { BASIC_LAND_NAMES, isSynthBasic } from "@/lib/limited.utils";
import type { DraftCard } from "@/types/limited";
import { limitedStateStorage, LIMITED_STORE_NAMES } from "@/game/limitedStorage";

export type BuildGroup = "none" | "color" | "cmc" | "type" | "rarity";
export type BuildZone = "pool" | "main" | "sideboard" | "maybe";
export interface LimitedDisplayPreferences {
  group: BuildGroup;
  cardSize: number;
  mode: "gallery" | "list";
}
export interface BuildAllocation {
  mainIds: string[];
  sideboardIds: string[];
  maybeIds: string[];
  basics: DraftCard[];
}
export interface NamedBuild extends BuildAllocation {
  id: string;
  name: string;
}
export interface BuildSession extends LimitedDisplayPreferences {
  pool: DraftCard[];
  allocation: BuildAllocation;
  undo: BuildAllocation[];
  redo: BuildAllocation[];
  builds: NamedBuild[];
}
interface PendingPick {
  id: string;
  zone: BuildZone;
}
interface BuildStore {
  sessions: Record<string, BuildSession>;
  displayPreferences: LimitedDisplayPreferences;
  pendingPicks: Record<string, PendingPick>;
  queuePick: (key: string, id: string, zone: PendingPick["zone"]) => void;
  cancelPick: (key: string, id: string) => void;
  suggest: (key: string, main: DraftCard[], sideboard: DraftCard[]) => void;
  quickPick: boolean;
  setQuickPick: (value: boolean) => void;
  sync: (
    key: string,
    pool: DraftCard[],
    initialMain?: DraftCard[],
    initialSideboard?: DraftCard[],
  ) => void;
  reconcilePool: (key: string, pool: DraftCard[]) => void;
  edit: (key: string, change: (allocation: BuildAllocation) => BuildAllocation) => void;
  move: (key: string, ids: readonly string[], zone: BuildZone) => void;
  undo: (key: string) => void;
  redo: (key: string) => void;
  preferences: (key: string, prefs: Partial<LimitedDisplayPreferences>) => void;
  saveBuild: (key: string, name: string) => void;
  loadBuild: (key: string, id: string) => void;
  deleteBuild: (key: string, id: string) => void;
}
function initialAllocation(
  pool: DraftCard[],
  main: DraftCard[],
  sideboard: DraftCard[],
): BuildAllocation {
  const used = new Set<string>();
  const basics: DraftCard[] = [];
  const mainIds: string[] = [];
  const sideboardIds: string[] = [];
  for (const [cards, inMain] of [
    [main, true],
    [sideboard, false],
  ] as const) {
    for (const card of cards) {
      let match = pool.find((candidate) => candidate.id === card.id && !used.has(candidate.id));
      if (!match && BASIC_LAND_NAMES.some((name) => name === card.name)) {
        match = { ...card };
        basics.push(match);
      }
      if (!match) continue;
      used.add(match.id);
      if (inMain) mainIds.push(match.id);
      else sideboardIds.push(match.id);
    }
  }
  return { mainIds, sideboardIds, maybeIds: [], basics };
}
export function buildDeck(session: Pick<BuildSession, "pool" | "allocation">) {
  const mainIds = new Set(session.allocation.mainIds);
  const cards = [...session.pool, ...session.allocation.basics];
  return {
    main: cards.filter((card) => mainIds.has(card.id)),
    sideboard: cards.filter((card) => !mainIds.has(card.id)),
  };
}

function movedAllocation(
  allocation: BuildAllocation,
  ids: readonly string[],
  zone: BuildZone,
): BuildAllocation {
  const moved = new Set(ids);
  const mainIds = allocation.mainIds.filter((id) => !moved.has(id));
  const sideboardIds = allocation.sideboardIds.filter((id) => !moved.has(id));
  const maybeIds = allocation.maybeIds.filter((id) => !moved.has(id));
  if (zone === "main") mainIds.push(...new Set(ids));
  if (zone === "sideboard") sideboardIds.push(...new Set(ids));
  if (zone === "maybe") maybeIds.push(...new Set(ids));
  return { ...allocation, mainIds, sideboardIds, maybeIds };
}

function editedSession(session: BuildSession, allocation: BuildAllocation): BuildSession {
  if (JSON.stringify(allocation) === JSON.stringify(session.allocation)) return session;
  return {
    ...session,
    allocation,
    undo: [...session.undo, session.allocation].slice(-80),
    redo: [],
  };
}

export function reconcileLimitedBuildPool(
  session: BuildSession,
  pool: DraftCard[],
  pending?: PendingPick,
): BuildSession {
  const acquired = new Set(pool.map((card) => card.id));
  const reconcile = (allocation: BuildAllocation): BuildAllocation => {
    const allowed = new Set([...acquired, ...allocation.basics.map((card) => card.id)]);
    return {
      ...allocation,
      mainIds: allocation.mainIds.filter((id) => allowed.has(id)),
      sideboardIds: allocation.sideboardIds.filter((id) => allowed.has(id)),
      maybeIds: allocation.maybeIds.filter((id) => allowed.has(id)),
    };
  };
  const reconciled = {
    ...session,
    pool,
    allocation: reconcile(session.allocation),
    undo: session.undo.map(reconcile),
    redo: session.redo.map(reconcile),
    builds: session.builds.map((build) => ({ ...build, ...reconcile(build) })),
  };
  return pending && acquired.has(pending.id)
    ? editedSession(reconciled, movedAllocation(reconciled.allocation, [pending.id], pending.zone))
    : reconciled;
}

export const useLimitedBuildStore = create<BuildStore>()(
  persist(
    (set, get) => ({
      sessions: {},
      displayPreferences: { group: "none", cardSize: 130, mode: "gallery" },
      pendingPicks: {},
      queuePick: (key, id, zone) =>
        set((state) => ({ pendingPicks: { ...state.pendingPicks, [key]: { id, zone } } })),
      cancelPick: (key, id) =>
        set((state) => {
          if (state.pendingPicks[key]?.id !== id) return state;
          const pendingPicks = { ...state.pendingPicks };
          delete pendingPicks[key];
          return { pendingPicks };
        }),
      quickPick: false,
      setQuickPick: (quickPick) => set({ quickPick }),
      sync: (key, pool, main = [], sideboard = []) => {
        set((state) => {
          const session = state.sessions[key];
          const knownBasics = new Set(
            [
              ...(session?.allocation.basics ?? []),
              ...(session?.builds.flatMap((build) => build.basics) ?? []),
              ...(session?.undo.flatMap((allocation) => allocation.basics) ?? []),
              ...(session?.redo.flatMap((allocation) => allocation.basics) ?? []),
            ].map((card) => card.id),
          );
          const existingIds = new Set(session?.pool.map((card) => card.id));
          const added = pool.filter(
            (card) => !isSynthBasic(card) && !knownBasics.has(card.id) && !existingIds.has(card.id),
          );
          if (session && !added.length) return state;
          const acquired = [...(session?.pool ?? []), ...added.map((card) => ({ ...card }))];
          return {
            sessions: {
              ...state.sessions,
              [key]: session
                ? { ...session, pool: acquired }
                : {
                    pool: acquired.map((card) => ({ ...card })),
                    allocation: initialAllocation(acquired, main, sideboard),
                    undo: [],
                    redo: [],
                    builds: [],
                    ...state.displayPreferences,
                  },
            },
          };
        });
        const pending = get().pendingPicks[key];
        if (!pending || !pool.some((card) => card.id === pending.id)) return;
        get().cancelPick(key, pending.id);
        get().move(key, [pending.id], pending.zone);
      },
      reconcilePool: (key, pool) =>
        set((state) => {
          const session = state.sessions[key];
          if (!session) return state;
          return {
            sessions: {
              ...state.sessions,
              [key]: reconcileLimitedBuildPool(session, pool),
            },
          };
        }),
      suggest: (key, main, sideboard) =>
        get().edit(key, () => initialAllocation(get().sessions[key].pool, main, sideboard)),
      edit: (key, change) =>
        set((state) => {
          const session = state.sessions[key];
          if (!session) return state;
          const edited = editedSession(session, change(session.allocation));
          if (edited === session) return state;
          return {
            sessions: { ...state.sessions, [key]: edited },
          };
        }),
      move: (key, ids, zone) =>
        get().edit(key, (allocation) => movedAllocation(allocation, ids, zone)),
      undo: (key) =>
        set((state) => {
          const session = state.sessions[key];
          const allocation = session?.undo.at(-1);
          if (!allocation) return state;
          return {
            sessions: {
              ...state.sessions,
              [key]: {
                ...session,
                allocation,
                undo: session.undo.slice(0, -1),
                redo: [...session.redo, session.allocation],
              },
            },
          };
        }),
      redo: (key) =>
        set((state) => {
          const session = state.sessions[key];
          const allocation = session?.redo.at(-1);
          if (!allocation) return state;
          return {
            sessions: {
              ...state.sessions,
              [key]: {
                ...session,
                allocation,
                undo: [...session.undo, session.allocation],
                redo: session.redo.slice(0, -1),
              },
            },
          };
        }),
      preferences: (key, prefs) =>
        set((state) => ({
          displayPreferences: { ...state.displayPreferences, ...prefs },
          sessions: state.sessions[key]
            ? { ...state.sessions, [key]: { ...state.sessions[key], ...prefs } }
            : state.sessions,
        })),
      saveBuild: (key, name) =>
        set((state) => {
          const session = state.sessions[key];
          const build = { ...session.allocation, name, id: crypto.randomUUID() };
          return {
            sessions: {
              ...state.sessions,
              [key]: { ...session, builds: [...session.builds, build] },
            },
          };
        }),
      loadBuild: (key, id) => {
        const build = get().sessions[key].builds.find((item) => item.id === id);
        if (build)
          get().edit(key, () => ({
            mainIds: build.mainIds,
            sideboardIds: build.sideboardIds,
            maybeIds: build.maybeIds,
            basics: build.basics,
          }));
      },
      deleteBuild: (key, id) =>
        set((state) => {
          const session = state.sessions[key];
          return {
            sessions: {
              ...state.sessions,
              [key]: { ...session, builds: session.builds.filter((item) => item.id !== id) },
            },
          };
        }),
    }),
    {
      name: LIMITED_STORE_NAMES.build,
      version: 1,
      storage: createJSONStorage(() => limitedStateStorage),
      migrate: (persistedState, version) => {
        const state = persistedState as Pick<BuildStore, "sessions" | "quickPick">;
        if (version < 1) {
          for (const session of Object.values(state.sessions)) {
            session.allocation.sideboardIds = [];
            for (const allocation of session.undo) allocation.sideboardIds = [];
            for (const allocation of session.redo) allocation.sideboardIds = [];
            for (const build of session.builds) build.sideboardIds = [];
          }
        }
        return state;
      },
      partialize: (state) => ({
        sessions: state.sessions,
        quickPick: state.quickPick,
        displayPreferences: state.displayPreferences,
      }),
    },
  ),
);
