import type { GameCard } from "@/types/manabrew";

export type Type = "reorderLibrary";
export type Input = {
  type: Type;
  cardIds: string[];
  cards: GameCard[];
};
export type Output = { type: "reorderLibraryDecision"; orderedCardIds: string[] };
