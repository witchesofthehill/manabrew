export type Type = "chooseDiscard";
export type Input = {
  type: Type;
  handCardIds: string[];
  numToDiscard: number;
};
export type Output = { type: "discardDecision"; discardedCardIds: string[] };
