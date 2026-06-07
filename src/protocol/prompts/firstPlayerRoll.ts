export type Type = "firstPlayerRoll";
export type Input = {
  type: Type;
  sides: number;
  firstPlayerRolls: Array<{ playerId: string; playerName: string; value: number }>;
  winnerPlayerId: string;
};
export type Output = { type: "firstPlayerRollAcknowledged" };
