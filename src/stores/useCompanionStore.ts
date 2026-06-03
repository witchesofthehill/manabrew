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
  CompanionPhase,
  CompanionPlayer,
  CompanionSession,
  ManaColor,
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
  /** Last archived session shown to the user as a post-game summary modal.
   *  Cleared when the user dismisses the summary. */
  summarySession: { session: CompanionSession; winnerId: string | null } | null;
  dismissSummary: () => void;
  /** Transient per-player pending life deltas (not persisted). */
  pendingDeltas: Record<string, { amount: number; expiresAt: number }>;

  newSession: (input: {
    playerCount: number;
    startingLife: number;
    commanderRules: boolean;
    layout?: CompanionLayout;
    carryRoster?: boolean;
    oathbreaker?: boolean;
  }) => void;
  endSession: (winnerId?: string | null) => void;
  resetCounters: (
    scope: "life" | "counters" | "commander-damage" | "all",
    playerId?: string,
  ) => void;
  /** Wipe every gameplay-state field on the current session — life,
   *  counters, mana, status chips, commander damage, turn / phase /
   *  active player, timer, history, redo. Keeps the configuration
   *  (player roster, layout, format, accents, commander picks). */
  resetGame: () => void;

  setLayout: (layout: CompanionLayout) => void;
  setStartingLife: (life: number) => void;
  setCommanderRules: (enabled: boolean) => void;
  setPlayerCount: (count: number) => void;

  renamePlayer: (playerId: string, name: string) => void;
  setPlayerNotes: (playerId: string, notes: string) => void;
  setSessionTag: (tag: string) => void;
  restoreFromArchive: (sessionId: string) => void;
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
  cycleRing: (playerId: string) => void;
  cycleSpeed: (playerId: string) => void;
  cycleDayNight: () => void;
  adjustMana: (playerId: string, color: ManaColor, delta: number) => void;
  clearMana: (playerId: string) => void;

  markDead: (playerId: string, dead: boolean) => void;

  undo: () => void;
  redo: () => void;

  startTimer: () => void;
  pauseTimer: () => void;
  resetTimer: () => void;
  setTimerMode: (mode: "shared" | "chess") => void;
  setPhase: (phase: CompanionPhase) => void;
  advancePhase: () => void;
  setActivePlayer: (playerId: string | null) => void;
  advanceTurn: () => void;
  pickRandomFirstPlayer: () => string | null;
  setFirstPlayer: (playerId: string) => void;
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
    redoStack: [],
    dayNight: null,
    timer: { startedAt: null, pausedAt: null, accumulatedMs: 0 },
    timerMode: "shared",
    chessClockStartedAt: null,
    phase: "main1",
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

function sameCommander(a: CompanionCommanderRef | null, b: CompanionCommanderRef | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.scryfallId && b.scryfallId) return a.scryfallId === b.scryfallId;
  return a.name === b.name;
}

function pushEvent(session: CompanionSession, event: CompanionEvent): CompanionSession {
  const history = [...session.history, event];
  if (history.length > COMPANION_HISTORY_LIMIT) {
    history.splice(0, history.length - COMPANION_HISTORY_LIMIT);
  }
  return { ...session, history, redoStack: [] };
}

function revertEvent(session: CompanionSession, event: CompanionEvent): CompanionSession {
  switch (event.type) {
    case "life":
      return replacePlayer(session, event.playerId, (p) => ({ ...p, life: event.prev }));
    case "counter":
      return replacePlayer(session, event.playerId, (p) => ({
        ...p,
        counters: p.counters.map((c) =>
          c.id === event.counterId ? { ...c, value: event.prev } : c,
        ),
      }));
    case "counterAdd":
      return replacePlayer(session, event.playerId, (p) => ({
        ...p,
        counters: p.counters.filter((c) => c.id !== event.counter.id),
      }));
    case "counterRemove":
      return replacePlayer(session, event.playerId, (p) => {
        const next = [...p.counters];
        const index = Math.min(Math.max(0, event.index), next.length);
        next.splice(index, 0, event.counter);
        return { ...p, counters: next };
      });
    case "commander":
      return replacePlayer(session, event.playerId, (p) => {
        const commanders = [...p.commanders] as CompanionPlayer["commanders"];
        commanders[event.slot] = event.prev;
        return { ...p, commanders };
      });
    case "dead":
      return replacePlayer(session, event.playerId, (p) => ({ ...p, isDead: event.prev }));
    case "cmdDmg": {
      const target = session.players.find((p) => p.id === event.targetId);
      const revertedPair: [number, number] = [
        ...(target?.commanderDamage[event.sourceId] ?? [0, 0]),
      ] as [number, number];
      revertedPair[event.slot] = event.prev;
      return replacePlayer(session, event.targetId, (p) => ({
        ...p,
        commanderDamage: { ...p.commanderDamage, [event.sourceId]: revertedPair },
        life: event.prevLife,
        isDead: event.prevDead,
      }));
    }
  }
}

function replayEvent(session: CompanionSession, event: CompanionEvent): CompanionSession {
  switch (event.type) {
    case "life":
      return replacePlayer(session, event.playerId, (p) => ({ ...p, life: event.next }));
    case "counter":
      return replacePlayer(session, event.playerId, (p) => ({
        ...p,
        counters: p.counters.map((c) =>
          c.id === event.counterId ? { ...c, value: event.next } : c,
        ),
      }));
    case "counterAdd":
      return replacePlayer(session, event.playerId, (p) =>
        p.counters.some((c) => c.id === event.counter.id)
          ? p
          : { ...p, counters: [...p.counters, event.counter] },
      );
    case "counterRemove":
      return replacePlayer(session, event.playerId, (p) => ({
        ...p,
        counters: p.counters.filter((c) => c.id !== event.counter.id),
      }));
    case "commander":
      return replacePlayer(session, event.playerId, (p) => {
        const commanders = [...p.commanders] as CompanionPlayer["commanders"];
        commanders[event.slot] = event.next;
        return { ...p, commanders };
      });
    case "dead":
      return replacePlayer(session, event.playerId, (p) => ({ ...p, isDead: event.next }));
    case "cmdDmg": {
      const target = session.players.find((p) => p.id === event.targetId);
      const replayedPair: [number, number] = [
        ...(target?.commanderDamage[event.sourceId] ?? [0, 0]),
      ] as [number, number];
      replayedPair[event.slot] = event.next;
      return replacePlayer(session, event.targetId, (p) => ({
        ...p,
        commanderDamage: { ...p.commanderDamage, [event.sourceId]: replayedPair },
        life: event.nextLife,
        isDead: event.nextDead,
      }));
    }
  }
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
        summarySession: null,
        pendingDeltas: {},
        dismissSummary: () => set({ summarySession: null }),

        newSession: ({
          playerCount,
          startingLife,
          commanderRules,
          layout,
          carryRoster,
          oathbreaker,
        }) => {
          clearAllPendingTimers();
          const current = get().session;
          const next = makeSession({ playerCount, startingLife, commanderRules, layout });
          if (oathbreaker) next.oathbreaker = true;
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
          set((state) => ({
            session: null,
            pendingDeltas: {},
            archive: [session, ...state.archive].slice(0, 10),
            summarySession: { session, winnerId: winnerId ?? null },
          }));
        },

        resetGame: () => {
          clearAllPendingTimers();
          // Single setState so there's no intermediate frame where the
          // session is reset but pendingDeltas still references the old
          // life batches.
          set((state) => {
            if (!state.session) return state;
            const session = state.session;
            return {
              session: {
                ...session,
                players: session.players.map((p) => ({
                  ...p,
                  life: session.startingLife,
                  counters: p.counters.map((c) => ({ ...c, value: 0 })),
                  commanderDamage: {},
                  isDead: false,
                  isMonarch: false,
                  hasInitiative: false,
                  hasCityBlessing: false,
                  ringLevel: 0,
                  speed: 0,
                  manaPool: {},
                  timeMs: 0,
                })),
                history: [],
                redoStack: [],
                turn: 0,
                activePlayerId: null,
                lastFirstPlayerId: null,
                phase: "main1",
                dayNight: null,
                timer: { startedAt: null, pausedAt: null, accumulatedMs: 0 },
                // Don't pre-arm the chess clock — there's no active player
                // yet. setFirstPlayer / advanceTurn will start it when one
                // actually takes their turn.
                chessClockStartedAt: null,
              },
              pendingDeltas: {},
            };
          });
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

        setPlayerNotes: (playerId, notes) =>
          set((state) =>
            withSession(state, (session) =>
              replacePlayer(session, playerId, (p) => ({ ...p, notes })),
            ),
          ),

        setSessionTag: (tag) =>
          set((state) => withSession(state, (session) => ({ ...session, tag }))),

        restoreFromArchive: (sessionId) => {
          const state = get();
          const target = state.archive.find((s) => s.id === sessionId);
          if (!target) return;
          clearAllPendingTimers();
          set({
            session: target,
            archive: state.archive.filter((s) => s.id !== sessionId),
            summarySession: null,
            pendingDeltas: {},
          });
        },

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
              if (sameCommander(prev, ref)) return session;
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
              const prevDead = target.isDead;
              const becomesDead =
                next >= COMPANION_LETHAL_COMMANDER_DAMAGE && session.commanderRules;
              const nextDead = prevDead || becomesDead;
              const updated = replacePlayer(session, targetId, (p) => ({
                ...p,
                commanderDamage: { ...p.commanderDamage, [sourceId]: nextPair },
                life: nextLife,
                isDead: nextDead,
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
                prevDead,
                nextDead,
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

        cycleRing: (playerId) =>
          set((state) =>
            withSession(state, (session) =>
              replacePlayer(session, playerId, (p) => ({
                ...p,
                ringLevel: ((p.ringLevel ?? 0) + 1) % 5,
              })),
            ),
          ),

        cycleSpeed: (playerId) =>
          set((state) =>
            withSession(state, (session) =>
              replacePlayer(session, playerId, (p) => ({
                ...p,
                speed: ((p.speed ?? 0) + 1) % 5,
              })),
            ),
          ),

        cycleDayNight: () =>
          set((state) =>
            withSession(state, (session) => {
              const next =
                session.dayNight === null ? "day" : session.dayNight === "day" ? "night" : null;
              return { ...session, dayNight: next };
            }),
          ),

        adjustMana: (playerId, color, delta) =>
          set((state) =>
            withSession(state, (session) =>
              replacePlayer(session, playerId, (p) => {
                const current = p.manaPool?.[color] ?? 0;
                const value = Math.max(0, current + delta);
                return { ...p, manaPool: { ...p.manaPool, [color]: value } };
              }),
            ),
          ),

        clearMana: (playerId) =>
          set((state) =>
            withSession(state, (session) =>
              replacePlayer(session, playerId, (p) => ({ ...p, manaPool: {} })),
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
              const reverted = revertEvent(session, last);
              return {
                ...reverted,
                history: session.history.slice(0, -1),
                redoStack: [...session.redoStack, last],
              };
            }),
          );
          set({ pendingDeltas: {} });
        },

        redo: () => {
          set((state) =>
            withSession(state, (session) => {
              if (session.redoStack.length === 0) return session;
              const next = session.redoStack[session.redoStack.length - 1]!;
              const replayed = replayEvent(session, next);
              return {
                ...replayed,
                history: [...session.history, next],
                redoStack: session.redoStack.slice(0, -1),
              };
            }),
          );
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
              chessClockStartedAt: session.timerMode === "chess" ? Date.now() : null,
              players: session.players.map((p) => ({ ...p, timeMs: 0 })),
            })),
          ),

        setTimerMode: (mode) =>
          set((state) =>
            withSession(state, (session) => ({
              ...session,
              timerMode: mode,
              chessClockStartedAt: mode === "chess" ? Date.now() : null,
            })),
          ),

        setPhase: (phase) =>
          set((state) => withSession(state, (session) => ({ ...session, phase }))),

        advancePhase: () =>
          set((state) =>
            withSession(state, (session) => {
              const order: CompanionPhase[] = [
                "untap",
                "upkeep",
                "draw",
                "main1",
                "combat",
                "main2",
                "end",
              ];
              const i = order.indexOf(session.phase);
              const next = order[(i + 1) % order.length]!;
              return { ...session, phase: next };
            }),
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
              // Storm count resets at the end of the turn (oracle rule 702.40).
              let players = session.players.map((p) => ({
                ...p,
                counters: p.counters.map((c) =>
                  c.kind === "storm" && c.value !== 0 ? { ...c, value: 0 } : c,
                ),
              }));
              let chessClockStartedAt = session.chessClockStartedAt;
              if (session.timerMode === "chess") {
                const now = Date.now();
                if (chessClockStartedAt != null && session.activePlayerId) {
                  const elapsed = now - chessClockStartedAt;
                  const prevId = session.activePlayerId;
                  players = players.map((p) =>
                    p.id === prevId ? { ...p, timeMs: (p.timeMs ?? 0) + elapsed } : p,
                  );
                }
                chessClockStartedAt = now;
              }
              return {
                ...session,
                players,
                activePlayerId: nextPlayer.id,
                turn: nextTurn,
                chessClockStartedAt,
              };
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

        setFirstPlayer: (playerId) =>
          set((state) =>
            withSession(state, (session) => {
              if (!session.players.some((p) => p.id === playerId)) return session;
              return {
                ...session,
                activePlayerId: playerId,
                turn: 1,
                lastFirstPlayerId: playerId,
                chessClockStartedAt: session.timerMode === "chess" ? Date.now() : null,
              };
            }),
          ),
      }),
      {
        name: STORAGE_KEYS.COMPANION,
        partialize: (state) => ({ session: state.session, archive: state.archive }),
        merge: (persistedState, currentState) => {
          if (!persistedState || typeof persistedState !== "object") return currentState;
          const incoming = persistedState as Partial<CompanionState>;
          const session = incoming.session
            ? { ...incoming.session, redoStack: incoming.session.redoStack ?? [] }
            : null;
          return { ...currentState, ...incoming, session };
        },
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
