import type { PlayZoneRect } from "../types";

/** User-selectable board arrangement (Settings). The two only diverge at 4
 *  players (3 opponents): `row` keeps opponents across the top; `perimeter`
 *  wraps them left/top/right around a center-bottom local player. */
export type BoardArrangement = "row" | "perimeter";

/**
 * Computed region rectangles for the unified board canvas. All rects are
 * canvas-local. A fixed center band carries the phase strip (no grip).
 */
export interface BoardLayout {
  self: PlayZoneRect;
  /** One rect per opponent, in the given opponent order. */
  opponents: PlayZoneRect[];
  /** Vertical center of the strip band — where the phase strip is drawn. */
  dividerY: number;
}

/** Fraction of the usable height (canvas minus strip band) given to the
 *  local player's bottom region. The rest is shared by the opponents. */
export const SELF_HEIGHT_FRACTION = 0.55;

/** Fixed vertical band, in px, reserved at the center for the phase strip. */
export const STRIP_BAND_PX = 56;

/** Width of each side column, as a fraction of canvas width, in the
 *  `perimeter` arrangement with 3 opponents. */
const PERIMETER_SIDE_FRACTION = 0.22;

export function computeBoardLayout(
  width: number,
  height: number,
  opponentCount: number,
  arrangement: BoardArrangement = "row",
): BoardLayout {
  const count = Math.max(1, opponentCount);
  const band = Math.min(STRIP_BAND_PX, Math.max(0, height - 2));
  const usable = Math.max(0, height - band);
  const selfHeight = Math.round(usable * SELF_HEIGHT_FRACTION);
  const topHeight = usable - selfHeight;
  const dividerY = topHeight + band / 2;

  // Perimeter only differs from row at 3 opponents — wrap left/top/right
  // around a center-bottom local player. With 1–2 opponents it's identical
  // to row, so fall through.
  if (arrangement === "perimeter" && count === 3) {
    const sideW = Math.round(width * PERIMETER_SIDE_FRACTION);
    const centerW = width - 2 * sideW;
    return {
      self: { x: sideW, y: topHeight + band, width: centerW, height: selfHeight },
      opponents: [
        { x: 0, y: 0, width: sideW, height },
        { x: sideW, y: 0, width: centerW, height: topHeight },
        { x: width - sideW, y: 0, width: sideW, height },
      ],
      dividerY,
    };
  }

  const colWidth = width / count;
  const opponents: PlayZoneRect[] = [];
  for (let i = 0; i < count; i++) {
    opponents.push({
      x: Math.round(i * colWidth),
      y: 0,
      width: Math.round((i + 1) * colWidth) - Math.round(i * colWidth),
      height: topHeight,
    });
  }

  return {
    self: { x: 0, y: topHeight + band, width, height: selfHeight },
    opponents,
    dividerY,
  };
}
