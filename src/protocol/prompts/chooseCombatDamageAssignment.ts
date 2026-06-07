export type Type = "chooseCombatDamageAssignment";
export type CombatDamageAssignment = {
  assigneeId: string;
  damage: number;
};
export type Input = {
  type: Type;
  attackerId: string;
  blockerIds: string[];
  defenderId?: string | null;
  totalDamage: number;
  attackerHasDeathtouch: boolean;
};
export type Output = {
  type: "combatDamageAssignmentDecision";
  assignments: CombatDamageAssignment[];
};
