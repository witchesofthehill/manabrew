import type { GameCard } from "@/types/manabrew";

export type Type = "dig";
export type Input = {
  type: Type;
  cardIds: string[];
  cards: GameCard[];
  numToTake: number;
  optional: boolean;
};
export type Output = { type: "digDecision"; chosenCardIds: string[] };
