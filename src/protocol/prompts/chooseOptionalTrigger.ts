import type { GameCard } from "@/types/manabrew";

export type Type = "chooseOptionalTrigger";
export type Input = {
  type: Type;
  description: string;
  cards?: GameCard[];
  promptKind?: string | null;
  optionLabels?: string[] | null;
  mode?: string | null;
  api?: string | null;
};
export type Output = { type: "optionalTriggerDecision"; accept: boolean };
