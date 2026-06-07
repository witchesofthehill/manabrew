export type Type = "chooseColor";
export type Input = {
  type: Type;
  validColors: string[];
};
export type Output = { type: "colorDecision"; color: string | null };
