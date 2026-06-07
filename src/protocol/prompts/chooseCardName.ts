export type Type = "chooseCardName";
export type Input = {
  type: Type;
  validNames: string[];
};
export type Output = { type: "cardNameDecision"; chosenName: string | null };
