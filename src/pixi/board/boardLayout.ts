import type { PlayZoneRect } from "../types";

/** Which screen edge a region's player is seated at. `bottom` is the local
 *  player (upright); `top` opponents are mirrored. */
export type RegionOrientation = "bottom" | "top";

/** One opponent's region. The `rect` is the FIXED full-width play area used for
 *  the grid and card positions — it never changes. `clipX`/`clipWidth` are the
 *  visible band between this field's two delimiters; only the clip moves, so
 *  the field's cards never move or reflow, and the bands tile the canvas (no
 *  overlap) so one field's cards can't bleed into another's. */
export interface OpponentRegion {
  rect: PlayZoneRect;
  orientation: RegionOrientation;
  clipX: number;
  clipWidth: number;
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
  /** Index of the opponent lifted on top (the widest column, expanded over the
   *  rest). */
  focusedOpponentIndex: number;
}

/** Fraction of the usable height (canvas minus strip band) given to the
 *  local player's bottom region. The rest is shared by the opponents. */
export const SELF_HEIGHT_FRACTION = 0.55;

/** Fixed vertical band, in px, reserved at the center for the phase strip. */
export const STRIP_BAND_PX = 56;

/** Width, in px, of a collapsed opponent column — just enough for a minimal
 *  banner peeking out from under its neighbour. */
export const COLLAPSED_OPPONENT_WIDTH_PX = 96;

export function computeBoardLayout(
  width: number,
  height: number,
  opponentCount: number,
  selfHeightFraction: number = SELF_HEIGHT_FRACTION,
  delimiters?: number[],
): BoardLayout {
  const count = Math.max(1, opponentCount);
  const band = Math.min(STRIP_BAND_PX, Math.max(0, height - 2));
  const usable = Math.max(0, height - band);
  const fraction = Math.min(0.8, Math.max(0.2, selfHeightFraction));
  const selfHeight = Math.round(usable * fraction);
  const topHeight = usable - selfHeight;
  const dividerY = topHeight + band / 2;

  const fieldWidth = Math.max(1, width - count * COLLAPSED_OPPONENT_WIDTH_PX);
  const step = count > 1 ? (width - fieldWidth) / (count - 1) : 0;
  const cuts = Array.from({ length: Math.max(0, count - 1) }, (_, i) =>
    delimiters && delimiters.length === count - 1 ? delimiters[i]! : (i + 1) / count,
  );

  const opponents: OpponentRegion[] = [];
  let maxWidth = -1;
  let focusedOpponentIndex = 0;
  for (let i = 0; i < count; i++) {
    const left = Math.round((i === 0 ? 0 : cuts[i - 1]!) * width);
    const right = Math.round((i === count - 1 ? 1 : cuts[i]!) * width);
    const w = Math.max(0, right - left);
    if (w > maxWidth) {
      maxWidth = w;
      focusedOpponentIndex = i;
    }
    opponents.push({
      rect: { x: Math.round(i * step), y: 0, width: fieldWidth, height: topHeight },
      orientation: "top",
      clipX: left,
      clipWidth: w,
    });
  }

  return {
    self: { x: 0, y: topHeight + band, width, height: selfHeight },
    opponents,
    dividerY,
    focusedOpponentIndex,
  };
}
