import type { GauntletState } from "@/types/limited";
import { limitedStateStorage, LIMITED_STORE_NAMES } from "@/game/limitedStorage";

const MATCH_KEY = LIMITED_STORE_NAMES.pendingGauntletMatch;
const PROGRESS_KEY = LIMITED_STORE_NAMES.gauntletProgress;

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

export async function configureGauntlet(
  state: GauntletState,
  sessionKey: string,
  bestOf: LimitedBestOf,
): Promise<void> {
  const records = readProgress();
  records[state.gauntletId] = {
    sessionKey,
    bestOf,
    round: state.currentRound,
    baselineWins: state.wins,
    baselineLosses: state.losses,
  };
  await limitedStateStorage.setItem(PROGRESS_KEY, JSON.stringify(records));
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

export async function advanceGauntletProgress(state: GauntletState): Promise<void> {
  const progress = gauntletProgress(state);
  await configureGauntlet(state, progress.sessionKey, progress.bestOf);
}

export async function arm(state: GauntletState): Promise<void> {
  const progress = gauntletProgress(state);
  const score = gauntletScore(state);
  await limitedStateStorage.setItem(
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

export async function clear(): Promise<void> {
  await limitedStateStorage.removeItem(MATCH_KEY);
}

export async function restoreGauntletProgress(
  gauntletId: string,
  progress: GauntletProgress,
): Promise<void> {
  const records = readProgress();
  records[gauntletId] = progress;
  await limitedStateStorage.setItem(PROGRESS_KEY, JSON.stringify(records));
}
