import type { BattlefieldState } from "../types";

/**
 * During declare-blockers, tapping an opponent's *attacking* creature selects
 * it as the attacker to block (routes to `onAttackerClick`, which sets the
 * pending attacker); every other opponent card tap is a normal click. The
 * region carries `attackingCardIds` only while `chooseBlockers` is active.
 */
export function isAttackerTap(state: BattlefieldState | null, cardId: string): boolean {
  return state?.attackingCardIds?.includes(cardId) ?? false;
}
