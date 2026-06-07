export type Type = "chooseAttackers";
export type Defender = {
  id: string;
  label: string;
};
export type AttackAssignment = {
  attackerId: string;
  defenderId: string;
};
export type Input = {
  type: Type;
  availableAttackerIds: string[];
  possibleDefenderIds: Defender[];
};
export type Output =
  | { type: "pass"; untilPhase?: string | null }
  | { type: "restoreSnapshot"; checkpointId: number }
  | { type: "declareAttackers"; assignments: AttackAssignment[] };
