export type Type = "chooseNumber";
export type Input = {
  type: Type;
  min: number;
  max: number;
};
export type Output = { type: "numberDecision"; chosenNumber: number | null };
