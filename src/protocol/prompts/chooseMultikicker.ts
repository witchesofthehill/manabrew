export type Type = "chooseMultikicker";
export type Input = {
  type: Type;
  cost: string;
  maxKicks: number;
};
export type Output = { type: "multikickerDecision"; kickCount: number };
