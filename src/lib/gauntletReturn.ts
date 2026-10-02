import type { GauntletState } from "@/types/limited";

const MATCH_KEY = "manabrew.pendingGauntletMatch";
const PROGRESS_KEY = "manabrew.gauntletProgress";

export type LimitedBestOf = 1 | 3;

export interface GauntletProgress {
  sessionKey: string;
  bestOf: LimitedBestOf;
  round: number;
  baselineWins: number;
  baselineLosses: number;
}

export interface PendingGauntletMatch {
  gauntletId: string;
  round: number;
  totalGames: number;
  wins: number;
  losses: number;
  bestOf: LimitedBestOf;
}

function readProgress(): Record<string, GauntletProgress> {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}") as Record<
      string,
      GauntletProgress
    >;
  } catch {
    return {};
  }
}

export function configureGauntlet(
  state: GauntletState,
  sessionKey: string,
  bestOf: LimitedBestOf,
): void {
  const records = readProgress();
  records[state.gauntletId] = {
    sessionKey,
    bestOf,
    round: state.currentRound,
    baselineWins: state.wins,
    baselineLosses: state.losses,
  };
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(records));
}

export function gauntletProgress(state: GauntletState): GauntletProgress {
  return (
    readProgress()[state.gauntletId] ?? {
      sessionKey: state.gauntletId,
      bestOf: 1,
      round: state.currentRound,
      baselineWins: 0,
      baselineLosses: 0,
    }
  );
}

export function gauntletScore(state: GauntletState) {
  const progress = gauntletProgress(state);
  const wins = state.wins - progress.baselineWins;
  const losses = state.losses - progress.baselineLosses;
  const required = Math.ceil(progress.bestOf / 2);
  return { wins, losses, matchOver: wins >= required || losses >= required };
}

export function advanceGauntletProgress(state: GauntletState): void {
  const progress = gauntletProgress(state);
  configureGauntlet(state, progress.sessionKey, progress.bestOf);
}

export function arm(state: GauntletState): void {
  const progress = gauntletProgress(state);
  const score = gauntletScore(state);
  localStorage.setItem(
    MATCH_KEY,
    JSON.stringify({
      gauntletId: state.gauntletId,
      round: state.currentRound,
      totalGames: state.wins + state.losses,
      wins: score.wins,
      losses: score.losses,
      bestOf: progress.bestOf,
    } satisfies PendingGauntletMatch),
  );
}

export function peek(): PendingGauntletMatch | null {
  try {
    const raw = localStorage.getItem(MATCH_KEY);
    return raw ? (JSON.parse(raw) as PendingGauntletMatch) : null;
  } catch {
    return null;
  }
}

export function clear(): void {
  localStorage.removeItem(MATCH_KEY);
}
