import type { CardDto, CombatAssignmentDto } from "@/protocol/game";

export interface CombatRow {
  defenderId: string;
  attackerIds: string[];
  groups: { controllerId: string; attackerIds: string[] }[];
  blocks: CombatAssignmentDto[];
}

export interface CombatRowInput {
  battlefield: CardDto[];
  combatAssignments: CombatAssignmentDto[];
  playerIds: string[];
  /** In-progress (pre-commit) attacker→target assignments from the local
   *  declaration, staged into the defender's row exactly like committed
   *  attackers so drag-declared creatures slide into the attack band. */
  pendingAttacks?: { attackerId: string; targetId: string }[];
}

export function buildCombatRows(input: CombatRowInput): CombatRow[] {
  const { battlefield, combatAssignments, playerIds, pendingAttacks } = input;
  const players = new Set(playerIds);
  const controllerById = new Map<string, string>();
  for (const c of battlefield) controllerById.set(c.id, c.controllerId);

  const defenderOf = (targetId: string): string | undefined =>
    players.has(targetId) ? targetId : controllerById.get(targetId);

  const rows = new Map<string, CombatRow>();
  const rowFor = (defenderId: string): CombatRow => {
    let r = rows.get(defenderId);
    if (!r) {
      r = { defenderId, attackerIds: [], groups: [], blocks: [] };
      rows.set(defenderId, r);
    }
    return r;
  };

  const attackerDefender = new Map<string, string>();
  for (const c of battlefield) {
    if (!c.isAttacking || !c.attackingPlayerId) continue;
    const defenderId = defenderOf(c.attackingPlayerId);
    if (!defenderId) continue;
    attackerDefender.set(c.id, defenderId);
    rowFor(defenderId).attackerIds.push(c.id);
  }

  for (const { attackerId, targetId } of pendingAttacks ?? []) {
    if (attackerDefender.has(attackerId)) continue;
    const defenderId = defenderOf(targetId);
    if (!defenderId) continue;
    attackerDefender.set(attackerId, defenderId);
    rowFor(defenderId).attackerIds.push(attackerId);
  }

  for (const a of combatAssignments) {
    const defenderId = attackerDefender.get(a.attackerId);
    if (defenderId) rowFor(defenderId).blocks.push(a);
  }

  for (const r of rows.values()) {
    const byCtrl = new Map<string, string[]>();
    for (const id of r.attackerIds) {
      const ctrl = controllerById.get(id);
      if (!ctrl) continue;
      const list = byCtrl.get(ctrl);
      if (list) list.push(id);
      else byCtrl.set(ctrl, [id]);
    }
    r.groups = [...byCtrl].map(([controllerId, attackerIds]) => ({ controllerId, attackerIds }));
  }

  return [...rows.values()];
}
