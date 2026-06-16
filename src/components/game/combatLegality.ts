import type { BlockableAttackerDto } from "@/protocol";

/**
 * Whether `blockerId` may legally block `attackerId`, per the engine's
 * per-attacker `validBlockerIds`. An attacker that isn't in the prompt (or
 * lists no valid blockers) can't be blocked.
 */
export function canBlockAttacker(
  attackers: BlockableAttackerDto[],
  blockerId: string,
  attackerId: string,
): boolean {
  const attacker = attackers.find((a) => a.attackerId === attackerId);
  return !!attacker && attacker.validBlockerIds.includes(blockerId);
}
