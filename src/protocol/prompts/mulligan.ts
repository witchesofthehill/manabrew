export type Type = "mulligan";
export type Input = {
  type: Type;
  handCardIds: string[];
  mulliganCount: number;
};
export type Output = { type: "mulliganDecision"; keep: boolean };
