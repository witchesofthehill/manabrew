export type Type = "chooseRollToIgnore";
export type Input = {
  type: Type;
  rolls: number[];
  sides?: number;
};
export type Output = { type: "rollToIgnoreDecision"; roll: number | null };
