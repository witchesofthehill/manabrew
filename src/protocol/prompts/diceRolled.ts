export type Type = "diceRolled";
export type Input = {
  type: Type;
  playerId: string;
  sides: number;
  naturalResults: number[];
  finalResults: number[];
  ignoredRolls: number[];
  sourceCardName?: string | null;
};
export type Output = { type: "diceRolledAcknowledged" };
