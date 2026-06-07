export type Type = "specifyManaCombo";
export type Input = {
  type: Type;
  availableColors: string[];
  amount: number;
};
export type Output = { type: "manaComboDecision"; chosenColors: string[] };
