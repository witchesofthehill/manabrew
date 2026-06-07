export type Type = "choosePhyrexian";
export type Input = { type: Type; phyrexianColor: string };
export type Output = { type: "phyrexianDecision"; payLife: boolean };
