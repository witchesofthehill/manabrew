import type { GameCard } from "@/types/manabrew";

export type Type = "chooseExertAttackers";
export type Input = {
  type: Type;
  attackerIds: string[];
  attackerCards: GameCard[];
};
export type Output = { type: "exertDecision"; chosenAttackerIds: string[] };
