import type { ForgeDeck } from "@manabrew/forge-wasm";

export interface DuelMatch {
  deck: ForgeDeck;
  opponents: ForgeDeck[];
  colors: string[][];
  startingLife: number;
}
