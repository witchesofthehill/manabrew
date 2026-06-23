/**
 * Tracks which phases each player "stops" at, and the current
 * pass-until auto-pass state. Lives in Zustand so any action
 * (castSpell, tapLand, etc.) can clear the auto-pass.
 */

import { create } from "zustand";

const DEFAULT_SELF_STOPS = new Set(["main1", "declare_attackers", "main2"]);
const DEFAULT_OPPONENT_STOPS = new Set(["end"]);

interface PhaseStopState {
  selfStops: Set<string>;
  opponentStops: Map<string, Set<string>>;
  smartSelfStops: Set<string>;
  smartOpponentStops: Map<string, Set<string>>;
  triggeredSmartStopPromptKeys: Set<string>;

  /** Active auto-pass: phase we're passing until. null inside Some = pass through everything. */
  passUntilPhase: string | null;
  /** Turn number when the pass-until was activated. null = no auto-pass. */
  passUntilTurn: number | null;

  toggleSelfStop: (phaseId: string) => void;
  toggleOpponentStop: (opponentId: string, phaseId: string) => void;
  getOpponentStops: (opponentId: string) => Set<string>;
  toggleSmartSelfStop: (phaseId: string) => void;
  toggleSmartOpponentStop: (opponentId: string, phaseId: string) => void;
  getSmartOpponentStops: (opponentId: string) => Set<string>;
  consumeSmartStop: (opponentId: string | null, phaseId: string) => void;
  markSmartStopPromptTriggered: (key: string) => void;
  clearSmartStops: () => void;

  /** Activate pass-until (called by unifiedPass / activatePassUntilEot). */
  setPassUntil: (phase: string | null, turn: number) => void;
  /** Cancel any active pass-until (called when user takes a non-pass action). */
  clearPassUntil: () => void;
}

export const usePhaseStopStore = create<PhaseStopState>((set, get) => ({
  selfStops: new Set(DEFAULT_SELF_STOPS),
  opponentStops: new Map(),
  smartSelfStops: new Set(),
  smartOpponentStops: new Map(),
  triggeredSmartStopPromptKeys: new Set(),
  passUntilPhase: null,
  passUntilTurn: null,

  toggleSelfStop: (phaseId) =>
    set((s) => {
      const next = new Set(s.selfStops);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return { selfStops: next };
    }),

  toggleOpponentStop: (opponentId, phaseId) =>
    set((s) => {
      const map = new Map(s.opponentStops);
      const current = map.get(opponentId) ?? new Set(DEFAULT_OPPONENT_STOPS);
      const next = new Set(current);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      map.set(opponentId, next);
      return { opponentStops: map };
    }),

  getOpponentStops: (opponentId) => {
    return get().opponentStops.get(opponentId) ?? new Set(DEFAULT_OPPONENT_STOPS);
  },

  toggleSmartSelfStop: (phaseId) =>
    set((s) => {
      const next = new Set(s.smartSelfStops);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return { smartSelfStops: next };
    }),

  toggleSmartOpponentStop: (opponentId, phaseId) =>
    set((s) => {
      const map = new Map(s.smartOpponentStops);
      const current = map.get(opponentId) ?? new Set<string>();
      const next = new Set(current);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      map.set(opponentId, next);
      return { smartOpponentStops: map };
    }),

  getSmartOpponentStops: (opponentId) => {
    return get().smartOpponentStops.get(opponentId) ?? new Set();
  },

  consumeSmartStop: (opponentId, phaseId) =>
    set((s) => {
      if (opponentId === null) {
        if (!s.smartSelfStops.has(phaseId)) return {};
        const next = new Set(s.smartSelfStops);
        next.delete(phaseId);
        return { smartSelfStops: next };
      }
      const current = s.smartOpponentStops.get(opponentId);
      if (!current?.has(phaseId)) return {};
      const map = new Map(s.smartOpponentStops);
      const next = new Set(current);
      next.delete(phaseId);
      map.set(opponentId, next);
      return { smartOpponentStops: map };
    }),

  markSmartStopPromptTriggered: (key) =>
    set((s) => {
      if (s.triggeredSmartStopPromptKeys.has(key)) return {};
      const next = new Set(s.triggeredSmartStopPromptKeys);
      next.add(key);
      return { triggeredSmartStopPromptKeys: next };
    }),

  clearSmartStops: () =>
    set({
      smartSelfStops: new Set(),
      smartOpponentStops: new Map(),
      triggeredSmartStopPromptKeys: new Set(),
    }),

  setPassUntil: (phase, turn) => set({ passUntilPhase: phase, passUntilTurn: turn }),
  clearPassUntil: () => set({ passUntilPhase: null, passUntilTurn: null }),
}));

/**
 * Given the current step and a set of enabled phase stops, find the next
 * phase the player should stop at. Returns the phase id, or null if no
 * stops remain in this turn (meaning pass through to end).
 */
const PHASE_ORDER = [
  "upkeep",
  "draw",
  "main1",
  "begin_combat",
  "declare_attackers",
  "declare_blockers",
  "first_strike_damage",
  "combat_damage",
  "end_combat",
  "main2",
  "end",
  "cleanup",
];

export function getNextStopPhase(currentStep: string, enabledStops: Set<string>): string | null {
  const currentIdx = PHASE_ORDER.indexOf(currentStep);
  if (currentIdx === -1) return null;
  for (let i = currentIdx + 1; i < PHASE_ORDER.length; i++) {
    if (enabledStops.has(PHASE_ORDER[i]!)) return PHASE_ORDER[i]!;
  }
  return null;
}
