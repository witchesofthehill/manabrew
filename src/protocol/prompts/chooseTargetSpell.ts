import type { TargetingIntent } from "@/types/promptType";

export type Type = "chooseTargetSpell";
export type Input = {
  type: Type;
  validSpellIds: string[];
  intent: TargetingIntent;
  minTargets: number;
  maxTargets: number;
  chosenTargets: number;
};
export type Output = { type: "targetSpell"; spellId: string | null };
