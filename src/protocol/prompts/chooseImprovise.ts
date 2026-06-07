export type Type = "chooseImprovise";
export type Input = {
  type: Type;
  validCardIds: string[];
  remainingCost: string;
};
export type Output = { type: "improviseDecision"; chosenCardIds: string[] };
