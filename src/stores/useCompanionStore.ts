import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";
import { STORAGE_KEYS } from "@/lib/constants";
import {
  COMPANION_ACCENT_KEYS,
  COMPANION_COMMANDER_STARTING_LIFE,
  COMPANION_DEFAULT_LAYOUT_BY_COUNT,
  COMPANION_DEFAULT_PLAYER_COUNT,
  COMPANION_DEFAULT_STARTING_LIFE,
  COMPANION_DELTA_BATCH_MS,
  COMPANION_HISTORY_LIMIT,
  COMPANION_LETHAL_COMMANDER_DAMAGE,
  COMPANION_MAX_PLAYERS,
  COMPANION_MIN_PLAYERS,
} from "./useCompanionStore.constants";
import type {
  CompanionAccentKey,
  CompanionCommanderRef,
  CompanionCommanderSlot,
  CompanionCounter,
  CompanionCounterKind,
  CompanionEvent,
  CompanionLayout,
  CompanionPlayer,
  CompanionSession,
} from "./useCompanionStore.types";

interface PendingDelta {
  playerId: string;
  amount: number;
  startedAt: number;
  prev: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface CompanionState {
  session: CompanionSession | null;
  archive: CompanionSession[];
  /** Transient per-player pending life deltas (not persisted). */
  pendingDeltas: Record<string, { amount: number; expiresAt: number }>;

  newSession: (input: {
    playerCount: number;
    startingLife: number;
    commanderRules: boolean;
    layout?: CompanionLayout;
    carryRoster?: boolean;
  }) => void;
  endSession: (winnerId?: string | null) => void;
  resetCounters: (
    scope: "life" | "counters" | "commander-damage" | "all",
    playerId?: string,
  ) => void;

  setLayout: (layout: CompanionLayout) => void;
  setStartingLife: (life: number) => void;
  setCommanderRules: (enabled: boolean) => void;
  setPlayerCount: (count: number) => void;

  renamePlayer: (playerId: string, name: string) => void;
  setPlayerAccent: (playerId: string, accent: CompanionAccentKey) => void;
  setCommander: (
    playerId: string,
    slot: CompanionCommanderSlot,
    ref: CompanionCommanderRef | null,
  ) => void;
  setFreePosition: (
    playerId: string,
    pos: { x: number; y: number; rotation: number; scale?: number },
  ) => void;

  adjustLife: (playerId: string, delta: number) => void;
  setLife: (playerId: string, value: number) => void;

  addCounter: (
    playerId: string,
    input: { kind: CompanionCounterKind; label: string; iconKey?: string; value?: number },
  ) => void;
  removeCounter: (playerId: string, counterId: string) => void;
  adjustCounter: (playerId: string, counterId: string, delta: number) => void;

  adjustCommanderDamage: (
    targetId: string,
    sourceId: string,
    slot: CompanionCommanderSlot,
    delta: number,
  ) => void;

  toggleMonarch: (playerId: string) => void;
  toggleInitiative: (playerId: string) => void;
  toggleCityBlessing: (playerId: string) => void;

  markDead: (playerId: string, dead: boolean) => void;

  undo: () => void;

  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  setActivePlayer: (playerId: string | null) => void;
  advanceTurn: () => void;
  pickRandomFirstPlayer: () => string | null;
}

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function defaultPlayerName(index: number): string {
  return `Player ${index + 1}`;
}

function accentForIndex(index: number): CompanionAccentKey {
  return COMPANION_ACCENT_KEYS[index % COMPANION_ACCENT_KEYS.length]!;
}

function makePlayer(index: number, startingLife: number): CompanionPlayer {
  return {
    id: uid(),
    name: defaultPlayerName(index),
    accentKey: accentForIndex(index),
    life: startingLife,
    counters: [],
    commanders: [null, null],
    commanderDamage: {},
    isDead: false,
  };
}

function makeSession(input: {
  playerCount: number;
  startingLife: number;
  commanderRules: boolean;
  layout?: CompanionLayout;
}): CompanionSession {
  const count = Math.min(COMPANION_MAX_PLAYERS, Math.max(COMPANION_MIN_PLAYERS, input.playerCount));
  const players = Array.from({ length: count }, (_, i) => makePlayer(i, input.startingLife));
  return {
    id: uid(),
    createdAt: Date.now(),
    startingLife: input.startingLife,
    commanderRules: input.commanderRules,
    layout: input.layout ?? COMPANION_DEFAULT_LAYOUT_BY_COUNT[count] ?? "free",
    players,
    history: [],
    timer: { startedAt: null, pausedAt: null, accumulatedMs: 0 },
    activePlayerId: null,
    turn: 0,
    lastFirstPlayerId: null,
  };
}

function withSession(
  state: CompanionState,
  mutate: (session: CompanionSession) => CompanionSession,
): Partial<CompanionState> {
  if (!state.session) return {};
  return { session: mutate(state.session) };
}

function pushEvent(session: CompanionSession, event: CompanionEvent): CompanionSession {
  const history = [...session.history, event];
  if (history.length > COMPANION_HISTORY_LIMIT) {
    history.splice(0, history.length - COMPANION_HISTORY_LIMIT);
  }
  return { ...session, history };
}

function replacePlayer(
  session: CompanionSession,
  playerId: string,
  patch: (p: CompanionPlayer) => CompanionPlayer,
): CompanionSession {
  return {
    ...session,
    players: session.players.map((p) => (p.id === playerId ? patch(p) : p)),
  };
}

const pendingDeltaTimers: Record<string, PendingDelta> = {};

function clearAllPendingTimers(): void {
  for (const id of Object.keys(pendingDeltaTimers)) {
    const pending = pendingDeltaTimers[id];
    if (pending?.timer) clearTimeout(pending.timer);
    delete pendingDeltaTimers[id];
  }
}

function flushPendingDelta(playerId: string): void {
  const pending = pendingDeltaTimers[playerId];
  if (!pending || pending.amount === 0) return;
  delete pendingDeltaTimers[playerId];
  const store = useCompanionStore.getState();
  if (!store.session) return;
  const player = store.session.players.find((p) => p.id === playerId);
  if (!player) return;
  useCompanionStore.setState((state) => {
    if (!state.session) return state;
    const nextLife = pending.prev + pending.amount;
    const session = pushEvent(
      replacePlayer(state.session, playerId, (p) => ({ ...p, life: nextLife })),
      { type: "life", playerId, prev: pending.prev, next: nextLife, at: Date.now() },
    );
    const { [playerId]: _drop, ...rest } = state.pendingDeltas;
    void _drop;
    return { ...state, session, pendingDeltas: rest };
  });
}

export const useCompanionStore = create<CompanionState>()(
  devtools(
    persist(
      (set, get) => ({
        session: null,
        archive: [],
        pendingDeltas: {},

        newSession: ({ playerCount, startingLife, commanderRules, layout, carryRoster }) => {
          clearAllPendingTimers();
          const current = get().session;
          const next = makeSession({ playerCount, startingLife, commanderRules, layout });
          if (carryRoster && current) {
            next.players = next.players.map((player, index) => {
              const carry = current.players[index];
              if (!carry) return player;
              return {
                ...player,
                name: carry.name,
                accentKey: carry.accentKey,
                commanders: carry.commanders,
              };
            });
          }
          set({ session: next, pendingDeltas: {} });
        },

        endSession: (winnerId) => {
          clearAllPendingTimers();
          const session = get().session;
          if (!session) return;
          void winnerId;
          set((state) => ({
            session: null,
            pendingDeltas: {},
            archive: [session, ...state.archive].slice(0, 10),
          }));
        },

        resetCounters: (scope, playerId) => {
          set((state) =>
            withSession(state, (session) => {
              const players = session.players.map((p) => {
                if (playerId && p.id !== playerId) return p;
                let next = p;
                if (scope === "life" || scope === "all") {
                  next = { ...next, life: session.startingLife, isDead: false };
                }
                if (scope === "counters" || scope === "all") {
                  next = {
                    ...next,
                    counters: next.counters.map((c) => ({ ...c, value: 0 })),
                  };
                }
                if (scope === "commander-damage" || scope === "all") {
                  next = { ...next, commanderDamage: {} };
                }
                return next;
              });
              return { ...session, players, history: [] };
            }),
          );
        },

        setLayout: (layout) =>
          set((state) => withSession(state, (session) => ({ ...session, layout }))),

        setStartingLife: (life) =>
          set((state) =>
            withSession(state, (session) => {
              const startingLife = Math.max(1, Math.round(life));
              const players = session.players.map((p) => ({ ...p, life: startingLife }));
              return { ...session, startingLife, players, history: [] };
            }),
          ),

        setCommanderRules: (enabled) =>
          set((state) =>
            withSession(state, (session) => ({ ...session, commanderRules: enabled })),
          ),

        setPlayerCount: (rawCount) => {
          set((state) =>
            withSession(state, (session) => {
              const count = Math.min(
                COMPANION_MAX_PLAYERS,
                Math.max(COMPANION_MIN_PLAYERS, Math.round(rawCount)),
              );
              if (count === session.players.length) return session;
              if (count < session.players.length) {
                const kept = session.players.slice(0, count);
                const stillAlive = kept.some((p) => p.id === session.activePlayerId);
                return {
                  ...session,
                  players: kept,
                  activePlayerId: stillAlive ? session.activePlayerId : null,
                  layout: COMPANION_DEFAULT_LAYOUT_BY_COUNT[count] ?? session.layout,
                };
              }
              const baseIndex = session.players.length;
              const added = Array.from({ length: count - baseIndex }, (_, offset) => {
                const i = baseIndex + offset;
                const newcomer = makePlayer(i, session.startingLife);
                newcomer.freeLayout = {
                  x: 40 + (i % 3) * 40,
                  y: 40 + Math.floor(i / 3) * 40,
                  rotation: 0,
                  scale: 1,
                };
                return newcomer;
              });
              return {
                ...session,
                players: [...session.players, ...added],
                layout: COMPANION_DEFAULT_LAYOUT_BY_COUNT[count] ?? session.layout,
              };
            }),
          );
        },

        renamePlayer: (playerId, name) =>
          set((state) =>
            withSession(state, (session) =>
              replacePlayer(session, playerId, (p) => ({ ...p, name })),
            ),
          ),

        setPlayerAccent: (playerId, accent) =>
          set((state) =>
            withSession(state, (session) =>
              replacePlayer(session, playerId, (p) => ({ ...p, accentKey: accent })),
            ),
          ),

        setCommander: (playerId, slot, ref) =>
          set((state) =>
            withSession(state, (session) => {
              const player = session.players.find((p) => p.id === playerId);
              if (!player) return session;
              const prev = player.commanders[slot] ?? null;
              if (prev === ref) return session;
              const updated = replacePlayer(session, playerId, (p) => {
                const next = [...p.commanders] as CompanionPlayer["commanders"];
                next[slot] = ref;
                return { ...p, commanders: next };
              });
              return pushEvent(updated, {
                type: "commander",
                playerId,
                slot,
                prev,
                next: ref,
                at: Date.now(),
              });
            }),
          ),

        setFreePosition: (playerId, pos) =>
          set((state) =>
            withSession(state, (session) =>
              replacePlayer(session, playerId, (p) => ({ ...p, freeLayout: pos })),
            ),
          ),

        adjustLife: (playerId, delta) => {
          if (delta === 0) return;
          const session = get().session;
          if (!session) return;
          const player = session.players.find((p) => p.id === playerId);
          if (!player) return;

          const existing = pendingDeltaTimers[playerId];
          if (existing?.timer) clearTimeout(existing.timer);
          const prev = existing?.prev ?? player.life;
          const amount = (existing?.amount ?? 0) + delta;
          const timer = setTimeout(() => flushPendingDelta(playerId), COMPANION_DELTA_BATCH_MS);
          pendingDeltaTimers[playerId] = {
            playerId,
            amount,
            startedAt: existing?.startedAt ?? Date.now(),
            prev,
            timer,
          };

          set((state) => ({
            session: replacePlayer(state.session ?? session, playerId, (p) => ({
              ...p,
              life: prev + amount,
            })),
            pendingDeltas: {
              ...state.pendingDeltas,
              [playerId]: { amount, expiresAt: Date.now() + COMPANION_DELTA_BATCH_MS },
            },
          }));
        },

        setLife: (playerId, value) => {
          set((state) =>
            withSession(state, (session) => {
              const player = session.players.find((p) => p.id === playerId);
              if (!player) return session;
              const next = Math.round(value);
              if (next === player.life) return session;
              return pushEvent(
                replacePlayer(session, playerId, (p) => ({ ...p, life: next })),
                { type: "life", playerId, prev: player.life, next, at: Date.now() },
              );
            }),
          );
        },

        addCounter: (playerId, input) =>
          set((state) =>
            withSession(state, (session) => {
              const player = session.players.find((p) => p.id === playerId);
              if (!player) return session;
              if (player.counters.some((c) => c.kind === input.kind && input.kind !== "custom")) {
                return session;
              }
              const counter: CompanionCounter = {
                id: uid(),
                kind: input.kind,
                label: input.label,
                value: input.value ?? 0,
                iconKey: input.iconKey,
              };
              const updated = replacePlayer(session, playerId, (p) => ({
                ...p,
                counters: [...p.counters, counter],
              }));
              return pushEvent(updated, {
                type: "counterAdd",
                playerId,
                counter,
                at: Date.now(),
              });
            }),
          ),

        removeCounter: (playerId, counterId) =>
          set((state) =>
            withSession(state, (session) => {
              const player = session.players.find((p) => p.id === playerId);
              if (!player) return session;
              const index = player.counters.findIndex((c) => c.id === counterId);
              if (index < 0) return session;
              const counter = player.counters[index]!;
              const updated = replacePlayer(session, playerId, (p) => ({
                ...p,
                counters: p.counters.filter((c) => c.id !== counterId),
              }));
              return pushEvent(updated, {
                type: "counterRemove",
                playerId,
                counter,
                index,
                at: Date.now(),
              });
            }),
          ),

        adjustCounter: (playerId, counterId, delta) => {
          if (delta === 0) return;
          set((state) =>
            withSession(state, (session) => {
              const player = session.players.find((p) => p.id === playerId);
              const counter = player?.counters.find((c) => c.id === counterId);
              if (!player || !counter) return session;
              const next = counter.value + delta;
              return pushEvent(
                replacePlayer(session, playerId, (p) => ({
                  ...p,
                  counters: p.counters.map((c) => (c.id === counterId ? { ...c, value: next } : c)),
                })),
                {
                  type: "counter",
                  playerId,
                  counterId,
                  prev: counter.value,
                  next,
                  at: Date.now(),
                },
              );
            }),
          );
        },

        adjustCommanderDamage: (targetId, sourceId, slot, delta) => {
          if (delta === 0) return;
          set((state) =>
            withSession(state, (session) => {
              const target = session.players.find((p) => p.id === targetId);
              if (!target) return session;
              const current = target.commanderDamage[sourceId] ?? [0, 0];
              const prev = current[slot];
              const next = Math.max(0, prev + delta);
              if (prev === next) return session;
              const nextPair: [number, number] = [...current] as [number, number];
              nextPair[slot] = next;
              const prevLife = target.life;
              const lifeDelta = -(next - prev);
              const nextLife = prevLife + lifeDelta;
              const becomesDead =
                next >= COMPANION_LETHAL_COMMANDER_DAMAGE && session.commanderRules;
              const updated = replacePlayer(session, targetId, (p) => ({
                ...p,
                commanderDamage: { ...p.commanderDamage, [sourceId]: nextPair },
                life: nextLife,
                isDead: p.isDead || becomesDead,
              }));
              return pushEvent(updated, {
                type: "cmdDmg",
                targetId,
                sourceId,
                slot,
                prev,
                next,
                prevLife,
                nextLife,
                at: Date.now(),
              });
            }),
          );
        },

        toggleMonarch: (playerId) =>
          set((state) =>
            withSession(state, (session) => {
              const target = session.players.find((p) => p.id === playerId);
              if (!target) return session;
              const willHold = !target.isMonarch;
              return {
                ...session,
                players: session.players.map((p) => ({
                  ...p,
                  isMonarch: willHold ? p.id === playerId : false,
                })),
              };
            }),
          ),

        toggleInitiative: (playerId) =>
          set((state) =>
            withSession(state, (session) => {
              const target = session.players.find((p) => p.id === playerId);
              if (!target) return session;
              const willHold = !target.hasInitiative;
              return {
                ...session,
                players: session.players.map((p) => ({
                  ...p,
                  hasInitiative: willHold ? p.id === playerId : false,
                })),
              };
            }),
          ),

        toggleCityBlessing: (playerId) =>
          set((state) =>
            withSession(state, (session) =>
              replacePlayer(session, playerId, (p) => ({
                ...p,
                hasCityBlessing: !p.hasCityBlessing,
              })),
            ),
          ),

        markDead: (playerId, dead) =>
          set((state) =>
            withSession(state, (session) => {
              const player = session.players.find((p) => p.id === playerId);
              if (!player || player.isDead === dead) return session;
              const updated = replacePlayer(session, playerId, (p) => ({ ...p, isDead: dead }));
              return pushEvent(updated, {
                type: "dead",
                playerId,
                prev: player.isDead,
                next: dead,
                at: Date.now(),
              });
            }),
          ),

        /**
         * Undo reverses one gameplay step. The history stack tracks: life
         * (`adjustLife`/`setLife`), counter values, counter add/remove,
         * commander damage (which also restores the linked life delta),
         * commander slot changes, and `markDead`. Configuration actions
         * (layout, player count, starting life, commander rules toggle,
         * monarch / initiative / blessing toggles, rename, accent, free
         * position) intentionally do NOT push history — they're treated as
         * setup, not gameplay.
         */
        undo: () => {
          /** Snapshot the in-flight life batches so we can revert player.life
           *  to the value before the current batch started. `adjustLife`
           *  mutates `life` immediately but only writes the history entry
           *  when the batch flushes, so without this an undo right after a
           *  tap would discard the timer but leave the visible damage. */
          const pendingPrev = Object.fromEntries(
            Object.entries(pendingDeltaTimers).map(([id, t]) => [id, t.prev]),
          );
          clearAllPendingTimers();
          const hadPending = Object.keys(pendingPrev).length > 0;
          set((state) =>
            withSession(state, (session) => {
              if (hadPending) {
                const players = session.players.map((p) =>
                  p.id in pendingPrev ? { ...p, life: pendingPrev[p.id]! } : p,
                );
                return { ...session, players };
              }
              if (session.history.length === 0) return session;
              const last = session.history[session.history.length - 1]!;
              const history = session.history.slice(0, -1);
              if (last.type === "life") {
                return {
                  ...replacePlayer(session, last.playerId, (p) => ({ ...p, life: last.prev })),
                  history,
                };
              }
              if (last.type === "counter") {
                return {
                  ...replacePlayer(session, last.playerId, (p) => ({
                    ...p,
                    counters: p.counters.map((c) =>
                      c.id === last.counterId ? { ...c, value: last.prev } : c,
                    ),
                  })),
                  history,
                };
              }
              if (last.type === "counterAdd") {
                return {
                  ...replacePlayer(session, last.playerId, (p) => ({
                    ...p,
                    counters: p.counters.filter((c) => c.id !== last.counter.id),
                  })),
                  history,
                };
              }
              if (last.type === "counterRemove") {
                return {
                  ...replacePlayer(session, last.playerId, (p) => {
                    const next = [...p.counters];
                    const index = Math.min(Math.max(0, last.index), next.length);
                    next.splice(index, 0, last.counter);
                    return { ...p, counters: next };
                  }),
                  history,
                };
              }
              if (last.type === "commander") {
                return {
                  ...replacePlayer(session, last.playerId, (p) => {
                    const commanders = [...p.commanders] as CompanionPlayer["commanders"];
                    commanders[last.slot] = last.prev;
                    return { ...p, commanders };
                  }),
                  history,
                };
              }
              if (last.type === "dead") {
                return {
                  ...replacePlayer(session, last.playerId, (p) => ({ ...p, isDead: last.prev })),
                  history,
                };
              }
              const revertedPair: [number, number] = [
                ...(session.players.find((p) => p.id === last.targetId)?.commanderDamage[
                  last.sourceId
                ] ?? [0, 0]),
              ] as [number, number];
              revertedPair[last.slot] = last.prev;
              const target = replacePlayer(session, last.targetId, (p) => ({
                ...p,
                commanderDamage: { ...p.commanderDamage, [last.sourceId]: revertedPair },
                life: last.prevLife,
              }));
              return { ...target, history };
            }),
          );
          set({ pendingDeltas: {} });
        },

        startTimer: () =>
          set((state) =>
            withSession(state, (session) => {
              if (session.timer.startedAt) return session;
              return {
                ...session,
                timer: { startedAt: Date.now(), pausedAt: null, accumulatedMs: 0 },
              };
            }),
          ),

        pauseTimer: () =>
          set((state) =>
            withSession(state, (session) => {
              if (!session.timer.startedAt || session.timer.pausedAt) return session;
              const elapsed = Date.now() - session.timer.startedAt;
              return {
                ...session,
                timer: {
                  startedAt: null,
                  pausedAt: Date.now(),
                  accumulatedMs: session.timer.accumulatedMs + elapsed,
                },
              };
            }),
          ),

        resetTimer: () =>
          set((state) =>
            withSession(state, (session) => ({
              ...session,
              timer: { startedAt: null, pausedAt: null, accumulatedMs: 0 },
            })),
          ),

        setActivePlayer: (playerId) =>
          set((state) =>
            withSession(state, (session) => ({ ...session, activePlayerId: playerId })),
          ),

        advanceTurn: () =>
          set((state) =>
            withSession(state, (session) => {
              if (session.players.length === 0) return session;
              const living = session.players.filter((p) => !p.isDead);
              if (living.length === 0) return session;
              const currentIndex = session.activePlayerId
                ? living.findIndex((p) => p.id === session.activePlayerId)
                : -1;
              const nextIndex = (currentIndex + 1) % living.length;
              const nextPlayer = living[nextIndex]!;
              const nextTurn =
                currentIndex < 0 ? 1 : nextIndex === 0 ? session.turn + 1 : session.turn;
              return { ...session, activePlayerId: nextPlayer.id, turn: nextTurn };
            }),
          ),

        pickRandomFirstPlayer: () => {
          const session = get().session;
          if (!session || session.players.length === 0) return null;
          const idx = Math.floor(Math.random() * session.players.length);
          const winner = session.players[idx]!;
          set((state) =>
            withSession(state, (s) => ({
              ...s,
              activePlayerId: winner.id,
              turn: 1,
              lastFirstPlayerId: winner.id,
            })),
          );
          return winner.id;
        },
      }),
      {
        name: STORAGE_KEYS.COMPANION,
        partialize: (state) => ({ session: state.session, archive: state.archive }),
      },
    ),
    { name: "companion", enabled: import.meta.env.DEV },
  ),
);

/** Quick-start helper used by the empty-state view. */
export function bootstrapCompanionSession(): void {
  if (useCompanionStore.getState().session) return;
  useCompanionStore.getState().newSession({
    playerCount: COMPANION_DEFAULT_PLAYER_COUNT,
    startingLife: COMPANION_DEFAULT_STARTING_LIFE,
    commanderRules: false,
  });
}

export { COMPANION_COMMANDER_STARTING_LIFE };
