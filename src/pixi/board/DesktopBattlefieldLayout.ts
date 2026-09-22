import { BATTLEFIELD_MIN_ROWS_LARGEST, FIELD_INNER_EDGE_PAD_PX } from "../constants";
import { battlefieldScaleForMultiplier, scaleForRowsWithCombatRow } from "../GridLayout";
import { computeBoardLayout } from "./boardLayout";
import type { BattlefieldLayoutPolicy, BattlefieldLayoutResult } from "./battlefieldLayoutPolicy";

export const DESKTOP_BATTLEFIELD_LAYOUT: BattlefieldLayoutPolicy = {
  showPhaseDivider: true,

  effectiveBottomReserve(requestedBottomReserve) {
    return requestedBottomReserve;
  },
  clusterHeight(_self, observedHandReserve, requestedBottomReserve) {
    return Math.max(observedHandReserve, requestedBottomReserve);
  },

  compute(input): BattlefieldLayoutResult {
    const layout = computeBoardLayout(
      input.width,
      input.height,
      input.opponentCount,
      input.requestedBottomReserve,
      false,
      0.5,
      input.opponentLayout,
    );
    const playmatTrim = (usable: number) => Math.max(1, usable - FIELD_INNER_EDGE_PAD_PX);
    const selfUsable = playmatTrim(Math.max(1, layout.self.height - input.requestedBottomReserve));
    const selfScale = Math.max(
      Number.EPSILON,
      Math.min(
        battlefieldScaleForMultiplier(selfUsable, input.cardSizeMultiplier),
        scaleForRowsWithCombatRow(selfUsable, BATTLEFIELD_MIN_ROWS_LARGEST),
      ),
    );
    const opponentUsables = layout.opponents.map((opponent) =>
      playmatTrim(Math.max(1, opponent.rect.height)),
    );
    const opponentUsable = opponentUsables.length ? Math.min(...opponentUsables) : selfUsable;
    const opponentScale = Math.max(
      Number.EPSILON,
      layout.opponentLayout === "overview"
        ? scaleForRowsWithCombatRow(opponentUsable, 1)
        : Math.min(
            battlefieldScaleForMultiplier(opponentUsable, input.cardSizeMultiplier),
            scaleForRowsWithCombatRow(opponentUsable, BATTLEFIELD_MIN_ROWS_LARGEST),
          ),
    );
    return {
      layout,
      scales: { self: selfScale, opponent: opponentScale },
      combatRowReserved: true,
      handScale: input.handViewportScale,
      selfClusterMaxHeight: Math.max(input.observedHandReserve, input.requestedBottomReserve),
    };
  },
};
