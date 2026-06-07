import type { GameCard } from "@/types/manabrew";

export type Type = "chooseEnlistAttackers";
export type Input = {
  type: Type;
  attackerIds: string[];
  attackerCards: GameCard[];
};
export type Output = { type: "enlistDecision"; chosenAttackerIds: string[] };
