import type { GameCard } from "@/types/manabrew";

export type Type = "chooseDamageAssignmentOrder";
export type Input = {
  type: Type;
  attackerId: string;
  blockerIds: string[];
  blockerCards: GameCard[];
};
export type Output = {
  type: "damageAssignmentOrderDecision";
  orderedBlockerIds: string[];
};
