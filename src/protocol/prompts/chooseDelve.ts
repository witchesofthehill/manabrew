import type { GameCard } from "@/types/manabrew";

export type Type = "chooseDelve";
export type Input = {
  type: Type;
  validCardIds: string[];
  zoneCards: GameCard[];
  maxCards: number;
};
export type Output = { type: "delveDecision"; chosenCardIds: string[] };
