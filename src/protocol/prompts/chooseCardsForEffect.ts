import type { GameCard } from "@/types/manabrew";

export type Type = "chooseCardsForEffect";
export type Input = {
  type: Type;
  validCardIds: string[];
  zoneCards: GameCard[];
  minChoices: number;
  maxChoices: number;
  sourceCardName?: string | null;
  optional?: boolean;
};
export type Output = { type: "chooseCardsDecision"; chosenCardIds: string[] };
