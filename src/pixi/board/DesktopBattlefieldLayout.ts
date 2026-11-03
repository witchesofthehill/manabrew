import { FIELD_INNER_EDGE_PAD_PX } from "../constants";
import { battlefieldScaleForMultiplier, scaleForRowsWithCombatRow } from "../GridLayout";
import { computeBoardLayout } from "./boardLayout";
import { playmatGridArea } from "./PlaymatLayer";
import type { BattlefieldLayoutPolicy, BattlefieldLayoutResult } from "./battlefieldLayoutPolicy";

export const DESKTOP_BATTLEFIELD_LAYOUT: BattlefieldLayoutPolicy = {
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
    const selfGrid = playmatGridArea(
      layout.self,
      { ...layout.self, height: Math.max(1, layout.self.height - input.requestedBottomReserve) },
      0,
    );
    const selfFromSeam = selfGrid.y + selfGrid.height - layout.self.y;
    const selfScale = Math.max(
      Number.EPSILON,
      battlefieldScaleForMultiplier(selfGrid.height, selfFromSeam, input.cardSizeMultiplier),
    );
    const opponentUsables = layout.opponents.map((opponent) =>
      playmatTrim(Math.max(1, opponent.rect.height)),
    );
    const opponentUsable = opponentUsables.length ? Math.min(...opponentUsables) : selfUsable;
    const opponentScale =
      layout.opponentLayout === "overview"
        ? Math.max(Number.EPSILON, scaleForRowsWithCombatRow(opponentUsable, 1))
        : selfScale;
    return {
      layout,
      scales: { self: selfScale, opponent: opponentScale },
      handScale: input.handViewportScale,
      selfClusterMaxHeight: Math.max(input.observedHandReserve, input.requestedBottomReserve),
    };
  },
};
