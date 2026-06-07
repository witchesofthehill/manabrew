export type Type = "chooseAlternativeCost";
export type Input = {
  type: Type;
  options: string[];
};
export type Output = { type: "alternativeCostDecision"; chosenIndex: number };
