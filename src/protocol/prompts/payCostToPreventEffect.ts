export type Type = "payCostToPreventEffect";
export type Input = {
  type: Type;
  description: string;
  costKind: string;
  api?: string | null;
};
export type Output = {
  type: "payCostToPreventEffectDecision";
  accept: boolean;
};
