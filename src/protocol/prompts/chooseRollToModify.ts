export type Type = "chooseRollToModify";
export type Input = {
  type: Type;
  rolls: number[];
  sides?: number;
};
export type Output = { type: "rollToModifyDecision"; roll: number | null };
