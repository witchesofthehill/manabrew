export interface AiSimulationSeatStats {
  prompts: number;
  casts: number;
  landPlays: number;
  abilities: number;
  passes: number;
  attackers: number;
  blocks: number;
  mulligans: number;
  promptTypes: Record<string, number>;
  actionLabels: Record<string, number>;
}

export interface AiSimulationGameResult {
  game: number;
  seed: number;
  outcome: string;
  winnerSeat: number | null;
  winnerDeckIndex: number | null;
  turns: number;
  durationMs: number;
  responseLatencyP50: number;
  responseLatencyP90: number;
  responseLatencyP99: number;
  /** Raw decision durations used to calculate accurate aggregate percentiles. */
  responseLatencies: number[];
  seats: Array<{ deckIndex: number; stats: AiSimulationSeatStats }>;
}

export interface AiSimulationDeckSummary {
  deckIndex: number;
  name: string;
  games: number;
  wins: number;
  winRate: number;
  average: Omit<AiSimulationSeatStats, "promptTypes" | "actionLabels">;
  promptTypes: Record<string, number>;
  actionLabels: Record<string, number>;
}

export interface AiSimulationSummary {
  requestedGames: number;
  completedGames: number;
  decidedGames: number;
  nonResults: number;
  averageTurns: number;
  medianTurns: number;
  averageDurationMs: number;
  medianDurationMs: number;
  responseLatencyP50: number;
  responseLatencyP90: number;
  responseLatencyP99: number;
  decks: AiSimulationDeckSummary[];
  seatWins: Array<{ seat: number; wins: number; games: number }>;
  results: AiSimulationGameResult[];
}

export type AiSimulationWorkerMessage =
  | { type: "progress"; completed: number; total: number; lastGame: AiSimulationGameResult }
  | { type: "complete"; summary: AiSimulationSummary }
  | { type: "cancelled"; summary: AiSimulationSummary }
  | { type: "error"; message: string };
