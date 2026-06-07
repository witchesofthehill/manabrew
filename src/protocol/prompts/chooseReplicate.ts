export type Type = "chooseReplicate";
export type Input = {
  type: Type;
  cost: string;
  maxReplicates: number;
};
export type Output = { type: "replicateDecision"; replicateCount: number };
