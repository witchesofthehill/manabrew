export type Type = "helpPayAssist";
export type Input = {
  type: Type;
  cardName: string;
  maxGeneric: number;
};
export type Output = { type: "assistDecision"; amountToPay: number };
