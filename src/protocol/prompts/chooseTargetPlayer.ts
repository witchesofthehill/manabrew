import type { TargetingIntent } from "@/types/promptType";

export type Type = "chooseTargetPlayer";
export type Input = {
  type: Type;
  validPlayerIds: string[];
  hostile?: boolean;
  intent: TargetingIntent;
};
export type Output = { type: "targetPlayer"; playerId: string | null };
