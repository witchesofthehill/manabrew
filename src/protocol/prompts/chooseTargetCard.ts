import type { TargetingIntent } from "@/types/promptType";

export type Type = "chooseTargetCard";
export type Input = {
  type: Type;
  validCardIds: string[];
  hostile?: boolean;
  intent: TargetingIntent;
  minTargets: number;
  maxTargets: number;
  chosenTargets: number;
};
export type Output = { type: "targetCard"; cardId: string | null };
