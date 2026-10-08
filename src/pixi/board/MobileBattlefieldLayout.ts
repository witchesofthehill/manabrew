import { CARD_W } from "@/components/game/game.constants";
import { FIELD_INNER_EDGE_PAD_PX } from "../constants";
import { maxScaleForRows } from "../GridLayout";
import { computeBoardLayout, type BoardLayout } from "./boardLayout";
import type { BattlefieldLayoutPolicy, BattlefieldLayoutResult } from "./battlefieldLayoutPolicy";

const MIN_THREE_ROW_CARD_WIDTH = 64;

function scaleForRows(layout: BoardLayout, selfRows: number): number {
  const selfUsable = Math.max(1, layout.self.height - FIELD_INNER_EDGE_PAD_PX);
  let scale = maxScaleForRows(selfUsable, selfRows, CARD_W);
  for (const opponent of layout.opponents) {
    const opponentUsable = Math.max(1, opponent.rect.height - FIELD_INNER_EDGE_PAD_PX);
    scale = Math.min(scale, maxScaleForRows(opponentUsable, 2, CARD_W));
  }
  return Math.max(Number.EPSILON, scale);
}

export const MOBILE_BATTLEFIELD_LAYOUT: BattlefieldLayoutPolicy = {
  showPhaseDivider: false,

  effectiveBottomReserve() {
    return 0;
  },
  clusterHeight(self) {
    return Math.max(1, self?.height ?? 1);
  },

  compute(input): BattlefieldLayoutResult {
    let layout = computeBoardLayout(
      input.width,
      input.height,
      input.opponentCount,
      0,
      true,
      0.6,
      input.opponentLayout,
    );
    let sharedScale = scaleForRows(layout, 3);
    if (sharedScale * CARD_W < MIN_THREE_ROW_CARD_WIDTH) {
      layout = computeBoardLayout(
        input.width,
        input.height,
        input.opponentCount,
        0,
        true,
        0.5,
        input.opponentLayout,
      );
      sharedScale = scaleForRows(layout, 2);
    }
    return {
      layout,
      scales: { self: sharedScale, opponent: sharedScale },
      combatRowReserved: false,
      handScale: 1,
      selfClusterMaxHeight: Math.max(1, layout.self.height),
    };
  },
};
