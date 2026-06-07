export type Type = "chooseMode";
export type Input = {
  type: Type;
  options: string[];
  minChoices: number;
  maxChoices: number;
  sourceCardName?: string | null;
};
export type Output = { type: "modeDecision"; chosenIndices: number[] };
