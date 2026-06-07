export type Type = "chooseType";
export type Input = {
  type: Type;
  typeCategory: string;
  validTypes: string[];
};
export type Output = { type: "typeDecision"; chosenType: string | null };
