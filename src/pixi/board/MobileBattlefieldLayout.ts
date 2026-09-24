import { FIELD_INNER_EDGE_PAD_PX } from "../constants";
import { maxScaleForRows } from "../GridLayout";
import { computeBoardLayout } from "./boardLayout";
import type { BattlefieldLayoutPolicy, BattlefieldLayoutResult } from "./battlefieldLayoutPolicy";

export const MOBILE_BATTLEFIELD_LAYOUT: BattlefieldLayoutPolicy = {
  showPhaseDivider: false,

  effectiveBottomReserve() {
    return 0;
  },
  clusterHeight(self) {
    return Math.max(1, self?.height ?? 1);
  },

  compute(input): BattlefieldLayoutResult {
    const layout = computeBoardLayout(
      input.width,
      input.height,
      input.opponentCount,
      0,
      true,
      0.6,
      input.opponentLayout,
    );
    const playmatTrim = (usable: number) => Math.max(1, usable - FIELD_INNER_EDGE_PAD_PX);
    const selfUsable = playmatTrim(Math.max(1, layout.self.height));
    const selfScale = Math.max(Number.EPSILON, maxScaleForRows(selfUsable, 2));
    const opponentUsables = layout.opponents.map((opponent) =>
      playmatTrim(Math.max(1, opponent.rect.height)),
    );
    const opponentUsable = opponentUsables.length ? Math.min(...opponentUsables) : selfUsable;
    const opponentScale = Math.max(Number.EPSILON, maxScaleForRows(opponentUsable, 1));
    const sharedScale = Math.min(selfScale, opponentScale);
    return {
      layout,
      scales: { self: sharedScale, opponent: sharedScale },
      combatRowReserved: false,
      handScale: 1,
      selfClusterMaxHeight: Math.max(1, layout.self.height),
    };
  },
};
