import type { DraftCard } from "@/types/limited";

export type LimitedHandPosition = "play" | "draw";
export type LimitedHandRandom = () => number;

export interface LimitedHandSample {
  cards: readonly DraftCard[];
  hand: readonly number[];
  library: readonly number[];
  bottom: readonly number[];
  mulligans: number;
  kept: boolean;
  turn: number;
  position: LimitedHandPosition;
  lastDrawn: number | null;
}
