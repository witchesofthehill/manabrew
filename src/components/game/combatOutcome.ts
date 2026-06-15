import type { GameCard } from "@/types/manabrew";

export interface CombatOutcome {
  /** Creatures that would die if combat damage were dealt now. */
  doomedCardIds: Set<string>;
  /** Damage each attacker would deal to the player it's attacking (unblocked
   *  power + trample spill-over), keyed by attacker id. */
  attackerFaceDamage: Map<string, number>;
}

const stat = (s?: string): number => {
  const n = Number.parseInt(s ?? "", 10);
  return Number.isFinite(n) ? n : 0;
};

const hasKeyword = (c: GameCard, kw: string): boolean =>
  c.keywords?.some((k) => k.toLowerCase() === kw) ?? false;

const dies = (creature: GameCard, incomingPower: number, deathtouch: boolean): boolean => {
  if (incomingPower <= 0) return false;
  if (hasKeyword(creature, "indestructible")) return false;
  if (deathtouch) return true;
  const remaining = stat(creature.toughness) - (creature.damage ?? 0);
  return incomingPower >= remaining;
};

/**
 * Predict the result of the current combat for a "would die" / incoming-damage
 * preview. Approximate: it ignores multi-blocker damage-assignment order and
 * first/double strike timing, so a blocker shared with others is flagged as if
 * it takes the attacker's full power.
 */
export function computeCombatOutcome(
  cards: GameCard[],
  assignments: { blockerId: string; attackerId: string }[],
): CombatOutcome {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const blockersByAttacker = new Map<string, GameCard[]>();
  for (const { blockerId, attackerId } of assignments) {
    const blocker = byId.get(blockerId);
    if (!blocker) continue;
    const list = blockersByAttacker.get(attackerId);
    if (list) list.push(blocker);
    else blockersByAttacker.set(attackerId, [blocker]);
  }

  const doomedCardIds = new Set<string>();
  const attackerFaceDamage = new Map<string, number>();

  for (const c of cards) {
    if (!c.isAttacking) continue;
    const blockers = blockersByAttacker.get(c.id) ?? [];
    if (blockers.length === 0) {
      const dmg = stat(c.power);
      if (dmg > 0) attackerFaceDamage.set(c.id, dmg);
      continue;
    }
    const blockersPower = blockers.reduce((sum, b) => sum + stat(b.power), 0);
    const blockerDeathtouch = blockers.some((b) => hasKeyword(b, "deathtouch"));
    if (dies(c, blockersPower, blockerDeathtouch)) doomedCardIds.add(c.id);

    const attackerDeathtouch = hasKeyword(c, "deathtouch");
    for (const b of blockers) {
      if (dies(b, stat(c.power), attackerDeathtouch)) doomedCardIds.add(b.id);
    }

    if (hasKeyword(c, "trample")) {
      const soak = blockers.reduce(
        (sum, b) => sum + Math.max(0, stat(b.toughness) - (b.damage ?? 0)),
        0,
      );
      const excess = stat(c.power) - soak;
      if (excess > 0) attackerFaceDamage.set(c.id, excess);
    }
  }

  return { doomedCardIds, attackerFaceDamage };
}
