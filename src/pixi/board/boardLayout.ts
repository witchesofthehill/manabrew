import type { PlayZoneRect } from "../types";

/** Which screen edge a region's player is seated at. `bottom` is the local
 *  player (upright); `top` opponents are mirrored. */
export type RegionOrientation = "bottom" | "top";

/** One opponent's region. The `rect` is the FIXED play area used for the grid
 *  and card positions — it never changes. The visible clip band (delimiters) is
 *  owned and animated by `BoardScene`, not computed here. */
export interface OpponentRegion {
  rect: PlayZoneRect;
  orientation: RegionOrientation;
}

/**
 * Computed region rectangles for the unified board canvas. All rects are
 * canvas-local. A fixed center band carries the phase strip (no grip).
 */
export interface BoardLayout {
  self: PlayZoneRect;
  /** One region per opponent, in the given opponent order. */
  opponents: OpponentRegion[];
  /** Vertical center of the strip band — where the phase strip is drawn. */
  dividerY: number;
}

/** Fraction of the usable height (canvas minus strip band) given to the
 *  local player's bottom region. The rest is shared by the opponents. */
export const SELF_HEIGHT_FRACTION = 0.55;

/** Fixed vertical band, in px, reserved at the center for the phase strip. */
export const STRIP_BAND_PX = 56;

/** Width, in px, of a collapsed opponent column — just enough for a minimal
 *  banner peeking out from under its neighbour. */
export const COLLAPSED_OPPONENT_WIDTH_PX = 150;

export function computeBoardLayout(
  width: number,
  height: number,
  opponentCount: number,
  selfHeightFraction: number = SELF_HEIGHT_FRACTION,
): BoardLayout {
  const count = Math.max(1, opponentCount);
  const band = Math.min(STRIP_BAND_PX, Math.max(0, height - 2));
  const usable = Math.max(0, height - band);
  const fraction = Math.min(0.8, Math.max(0.2, selfHeightFraction));
  const selfHeight = Math.round(usable * fraction);
  const topHeight = usable - selfHeight;
  const dividerY = topHeight + band / 2;

  // Each opponent field's `rect` is the FIXED play area — grid and card positions
  // are computed from it and never move. Every field is `L - n·x` wide (canvas
  // minus one un-collapsible banner per field) and the fields are staggered by a
  // constant step so the `n` of them span the whole canvas. The visible clip band
  // per field (the delimiters) is owned and eased by `BoardScene`.
  const fieldWidth = Math.max(1, width - count * COLLAPSED_OPPONENT_WIDTH_PX);
  const step = count > 1 ? (width - fieldWidth) / (count - 1) : 0;

  const opponents: OpponentRegion[] = [];
  for (let i = 0; i < count; i++) {
    opponents.push({
      rect: { x: Math.round(i * step), y: 0, width: fieldWidth, height: topHeight },
      orientation: "top",
    });
  }

  return {
    self: { x: 0, y: topHeight + band, width, height: selfHeight },
    opponents,
    dividerY,
  };
}
