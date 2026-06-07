import type { GameCard } from "@/types/manabrew";

export type Type = "scry";
export type Input = {
  type: Type;
  cardIds: string[];
  cards: GameCard[];
};
export type Output = { type: "scryDecision"; bottomCardIds: string[] };
