export type Type = "chooseConvoke";
export type Input = {
  type: Type;
  validCardIds: string[];
  remainingCost: string;
};
export type Output = { type: "convokeDecision"; chosenCardIds: string[] };
