import type { GameCard } from "@/types/manabrew";
import type { TargetingIntent } from "@/types/promptType";

export type Type = "chooseTargetCardFromZone";
export type Input = {
  type: Type;
  validCardIds: string[];
  zone: string;
  zoneCards: GameCard[];
  intent: TargetingIntent;
  minTargets: number;
  maxTargets: number;
  chosenTargets: number;
};
export type Output = { type: "targetCard"; cardId: string | null };
