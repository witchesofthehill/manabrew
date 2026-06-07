export type Type = "chooseRollToSwap";
export type Input = {
  type: Type;
  rolls: number[];
  sides?: number;
};
export type Output = { type: "rollToSwapDecision"; roll: number | null };
