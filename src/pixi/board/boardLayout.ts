import type { PlayZoneRect } from "../types";

/**
 * Computed region rectangles for the unified board canvas. The local player
 * always owns the full-width bottom region; opponents share the top, split
 * into equal columns (1 → full, 2 → halves, 3 → thirds). A fixed center band
 * carries the phase strip (no resizable grip). All rects are canvas-local.
 */
export interface BoardLayout {
  self: PlayZoneRect;
  /** One rect per opponent, in the given opponent order (left → right). */
  opponents: PlayZoneRect[];
  /** Vertical center of the strip band — where the phase strip is drawn. */
  dividerY: number;
}

/** Fraction of the usable height (canvas minus strip band) given to the
 *  local player's bottom region. The rest is shared by the opponents' row. */
export const SELF_HEIGHT_FRACTION = 0.5;

/** Fixed vertical band, in px, reserved at the center for the phase strip. */
export const STRIP_BAND_PX = 56;

export function computeBoardLayout(
  width: number,
  height: number,
  opponentCount: number,
): BoardLayout {
  const count = Math.max(1, opponentCount);
  const band = Math.min(STRIP_BAND_PX, Math.max(0, height - 2));
  const usable = Math.max(0, height - band);
  const selfHeight = Math.round(usable * SELF_HEIGHT_FRACTION);
  const topHeight = usable - selfHeight;
  const dividerY = topHeight + band / 2;

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
