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
  opponents: OpponentRegion[];
  dividerY: number;
  stripBandPx: number;
}

/** Fixed vertical band, in px, reserved at the center for the phase strip. */
export const STRIP_BAND_PX = 38;

export const STRIP_BAND_COMPACT_PX = 32;

/** Width, in px, of a collapsed opponent column — just enough for the avatar
 *  sphere + life banner peeking out from under its neighbour. */
export const COLLAPSED_OPPONENT_WIDTH_PX = 80;

export function computeBoardLayout(
  width: number,
  height: number,
  opponentCount: number,
  selfBottomReserve = 0,
  compact = false,
): BoardLayout {
  const count = Math.max(1, opponentCount);
  const bandPx = compact ? STRIP_BAND_COMPACT_PX : STRIP_BAND_PX;
  const band = Math.min(bandPx, Math.max(0, height - 2));
  const usable = Math.max(0, height - band);
  const fraction =
    usable > 0 ? Math.min(0.8, Math.max(0.2, 0.5 + selfBottomReserve / (2 * usable))) : 0.5;
  const selfHeight = Math.round(usable * fraction);
  const topHeight = usable - selfHeight;
  const dividerY = topHeight + band / 2;

  // Each opponent field's `rect` is the FIXED play area — grid and card positions
  // are computed from it and never move. Field `i` starts at `i` collapsed-banner
  // widths from the left and extends to the canvas right edge, so its rect equals
  // its maximally-expanded clip band (every field left of it collapsed to a
  // banner). Because a delimiter can never push field `i`'s band-left below
  // `i · COLLAPSED` (the grip clamp uses that as `minGap`), the band is always a
  // subset of the rect — the felt/grid/cards align with the field's visible left
  // edge when expanded, never leaving a gap. The clip band is eased by `BoardScene`.
  const opponents: OpponentRegion[] = [];
  for (let i = 0; i < count; i++) {
    const x = i * COLLAPSED_OPPONENT_WIDTH_PX;
    opponents.push({
      rect: { x, y: 0, width: Math.max(1, width - x), height: topHeight },
      orientation: "top",
    });
  }

  return {
    self: { x: 0, y: topHeight + band, width, height: selfHeight },
    opponents,
    dividerY,
    stripBandPx: band,
  };
}
