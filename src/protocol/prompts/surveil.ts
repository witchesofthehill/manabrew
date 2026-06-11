import type { GameCard } from "@/types/manabrew";

export type Type = "surveil";
export type Input = {
  type: Type;
  cardIds: string[];
  cards: GameCard[];
};
export type Output = {
  type: "surveilDecision";
  graveyardCardIds: string[];
  topCardIds?: string[];
};
