export type Type = "chooseRollSwapValue";
export type Input = {
  type: Type;
  currentResult: number;
  power: number;
  toughness: number;
};
export type Output = {
  type: "rollSwapValueDecision";
  choice: "power" | "toughness" | null;
};
