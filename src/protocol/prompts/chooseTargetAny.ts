import type { TargetingIntent } from "@/types/promptType";

export type Type = "chooseTargetAny";
export type TargetChoice =
  | { kind: "player"; playerId: string }
  | { kind: "card"; cardId: string }
  | { kind: "none" };
export type Input = {
  type: Type;
  validPlayerIds: string[];
  validCardIds: string[];
  hostile?: boolean;
  intent: TargetingIntent;
};
export type Output = { type: "targetAny"; target: TargetChoice };
