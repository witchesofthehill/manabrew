export type Type = "chooseDiceToReroll";
export type Input = {
  type: Type;
  rolls: number[];
  sides?: number;
};
export type Output = { type: "diceToRerollDecision"; rolls: number[] };
