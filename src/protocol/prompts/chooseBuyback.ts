export type Type = "chooseBuyback";
export type Input = { type: Type; buybackCost: string };
export type Output = { type: "buybackDecision"; buybackPaid: boolean };
