export type Type = "chooseKicker";
export type Input = { type: Type; kickerCost: string };
export type Output = { type: "kickerDecision"; kicked: boolean };
