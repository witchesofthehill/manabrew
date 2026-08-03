/**
 * Tracks which phases each player "stops" at. The pass-until target derived
 * from these stops is sent to the engine, which holds it; the client no
 * longer tracks an active pass-until itself.
 */

import { create } from "zustand";
import type { StepKind } from "@/protocol";
import { PHASES } from "@/components/game/game.constants";

const DEFAULT_SELF_STOPS = new Set<string>([
  "main1",
  "combatDeclareAttackers",
  "main2",
] satisfies StepKind[]);
export const DEFAULT_OPPONENT_STOPS = new Set<string>(["endOfTurn"] satisfies StepKind[]);

interface PhaseStopState {
  selfStops: Set<string>;
  opponentStops: Map<string, Set<string>>;

  toggleSelfStop: (phaseId: string) => void;
  toggleOpponentStop: (opponentId: string, phaseId: string) => void;
  getOpponentStops: (opponentId: string) => Set<string>;
}

export const usePhaseStopStore = create<PhaseStopState>((set, get) => ({
  selfStops: new Set(DEFAULT_SELF_STOPS),
  opponentStops: new Map(),

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
}));

const PHASE_ORDER: readonly StepKind[] = PHASES.filter((p) => p.id !== "untap").map((p) => p.id);

/**
 * Walk forward through (player, phase) slots in turn order — starting just
 * after the current (activePlayer, currentStep) — and return the first slot
 * the local player has set a stop for. A stop is genuinely `(player, phase)`:
 * "stop at Player2's end" is distinct from "stop at my end". Returns null when
 * no stop exists anywhere in a full turn cycle (pass through everything).
 */
export function getNextStop(
  playerOrder: string[],
  activePlayerId: string,
  currentStep: StepKind,
  myId: string,
  selfStops: Set<string>,
  getOpponentStops: (opponentId: string) => Set<string>,
): { playerId: string; phase: StepKind } | null {
  const n = playerOrder.length;
  const startIdx = playerOrder.indexOf(activePlayerId);
  if (n === 0 || startIdx === -1) return null;
  const currentPhaseIdx = PHASE_ORDER.indexOf(currentStep);
  // n + 1 slots covers the active player's remaining phases, every other
  // player's full turn, then the active player's next full turn — one whole
  // cycle, so any standing stop is found at its earliest future occurrence.
  for (let slot = 0; slot <= n; slot++) {
    const playerId = playerOrder[(startIdx + slot) % n]!;
    const stops = playerId === myId ? selfStops : getOpponentStops(playerId);
    // For the active player's current turn (slot 0) skip phases already elapsed.
    // If currentStep isn't in PHASE_ORDER we can't tell how far in we are, so skip
    // this turn entirely rather than emit a stop for a possibly-passed phase.
    const phaseStart =
      slot === 0 ? (currentPhaseIdx < 0 ? PHASE_ORDER.length : currentPhaseIdx + 1) : 0;
    for (let i = phaseStart; i < PHASE_ORDER.length; i++) {
      if (stops.has(PHASE_ORDER[i]!)) return { playerId, phase: PHASE_ORDER[i]! };
    }
  }
  return null;
}

/**
 * End-turn variant of getNextStop: the first stop from the start of the next
 * player's turn, skipping every remaining stop in the active player's turn.
 * Falls back to the next player's upkeep so the engine always has a target.
 */
export function getEndTurnStop(
  playerOrder: string[],
  activePlayerId: string,
  myId: string,
  selfStops: Set<string>,
  getOpponentStops: (opponentId: string) => Set<string>,
): { playerId: string; phase: StepKind } | null {
  const n = playerOrder.length;
  const startIdx = playerOrder.indexOf(activePlayerId);
  if (n === 0 || startIdx === -1) return null;
  for (let slot = 1; slot <= n; slot++) {
    const playerId = playerOrder[(startIdx + slot) % n]!;
    const stops = playerId === myId ? selfStops : getOpponentStops(playerId);
    for (const phase of PHASE_ORDER) {
      if (stops.has(phase)) return { playerId, phase };
    }
  }
  return { playerId: playerOrder[(startIdx + 1) % n]!, phase: "upkeep" };
}
