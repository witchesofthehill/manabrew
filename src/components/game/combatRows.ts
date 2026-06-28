import type { CardDto, CombatAssignmentDto } from "@/protocol/game";

export interface CombatRow {
  /** The defending player whose battlefield hosts this combat row. */
  defenderId: string;
  /** Ids of the attacking creatures aimed at this defender (drawn in the row). */
  attackerIds: string[];
  /** Declared blocks against those attackers — the defender's own creatures. */
  blocks: CombatAssignmentDto[];
}

export interface CombatRowInput {
  battlefield: CardDto[];
  combatAssignments: CombatAssignmentDto[];
  /** The local player; combat involving them keeps the existing center flow. */
  selfId: string;
  playerIds: string[];
}

/**
 * Group **opponent-vs-opponent** combat by defending player for the per-opponent
 * combat row. Any combat where the local player is the attacker's controller or
 * the defender is excluded (that stays on the center flow). An attacker aimed at
 * a planeswalker/battle is grouped under that permanent's controller.
 */
export function buildCombatRows(input: CombatRowInput): CombatRow[] {
  const { battlefield, combatAssignments, selfId, playerIds } = input;
  const players = new Set(playerIds);
  const controllerById = new Map<string, string>();
  for (const c of battlefield) controllerById.set(c.id, c.controllerId);

  const defenderOf = (targetId: string): string | undefined =>
    players.has(targetId) ? targetId : controllerById.get(targetId);

  const rows = new Map<string, CombatRow>();
  const rowFor = (defenderId: string): CombatRow => {
    let r = rows.get(defenderId);
    if (!r) {
      r = { defenderId, attackerIds: [], blocks: [] };
      rows.set(defenderId, r);
    }
    return r;
  };

  const attackerDefender = new Map<string, string>();
  for (const c of battlefield) {
    if (!c.isAttacking || !c.attackingPlayerId || c.controllerId === selfId) continue;
    const defenderId = defenderOf(c.attackingPlayerId);
    if (!defenderId || defenderId === selfId) continue;
    attackerDefender.set(c.id, defenderId);
    rowFor(defenderId).attackerIds.push(c.id);
  }

  for (const a of combatAssignments) {
    const defenderId = attackerDefender.get(a.attackerId);
    if (defenderId) rowFor(defenderId).blocks.push(a);
  }

  return [...rows.values()];
}
