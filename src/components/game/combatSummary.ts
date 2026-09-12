import type { CardDto } from "@/protocol/game";
import type { CombatAssignment } from "./game.types";

export interface CombatSummary {
  attackerCount: number;
  blockedCount: number;
  unblockedCount: number;
  estimatedDamage: number;
  firstStrike: boolean;
}
export function summarizeCombat(
  attackerIds: string[],
  blocks: CombatAssignment[],
  resolveCard: (id: string) => CardDto | undefined,
): CombatSummary {
  const blocked = new Set(blocks.map((block) => block.attackerId));
  const blockedCount = attackerIds.filter((id) => blocked.has(id)).length;
  const estimatedDamage = attackerIds.reduce((sum, id) => {
    if (blocked.has(id)) return sum;
    const card = resolveCard(id);
    const parsed = Number.parseInt(card?.power ?? "0", 10);
    const power = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    const doubleStrike = card?.keywords.some((keyword) =>
      keyword.toLowerCase().startsWith("double strike"),
    );
    return sum + power * (doubleStrike ? 2 : 1);
  }, 0);
  const firstStrike = [...attackerIds, ...blocks.map((block) => block.blockerId)].some((id) =>
    resolveCard(id)?.keywords.some((keyword) => /^(first|double) strike/i.test(keyword)),
  );
  return {
    attackerCount: attackerIds.length,
    blockedCount,
    unblockedCount: attackerIds.length - blockedCount,
    estimatedDamage,
    firstStrike,
  };
}
