export type Type = "chooseBlockers";
export type BlockAssignment = {
  blockerId: string;
  attackerId: string;
};
export type Input = {
  type: Type;
  attackerIds: string[];
  availableBlockerIds: string[];
};
export type Output =
  | { type: "pass"; untilPhase?: string | null }
  | { type: "restoreSnapshot"; checkpointId: number }
  | { type: "declareBlockers"; assignments: BlockAssignment[] };
