import type { PlayZoneRect } from "../types";

/** User-selectable board arrangement (Settings). The two only diverge at 4
 *  players (3 opponents): `row` keeps opponents across the top; `perimeter`
 *  wraps them left/top/right around a center-bottom local player. */
export type BoardArrangement = "row" | "perimeter";

/** Which screen edge a region's player is seated at. `bottom` is the local
 *  player (upright); `top` opponents are mirrored; `left`/`right` opponents
 *  are rotated 90° to face the table center. */
export type RegionOrientation = "bottom" | "top" | "left" | "right";

/** One opponent's region: its canvas-local rect and the edge it's seated at. */
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

/** Width of each side column, as a fraction of canvas width, in the
 *  `perimeter` arrangement with 3 opponents. Kept narrow so the local
 *  player's center column — where most interaction happens — stays wide. */
export const PERIMETER_SIDE_FRACTION = 0.15;

/** Width, in px, of a collapsed opponent column in the multiplayer accordion
 *  layout — just enough for a minimal banner. Tweak freely. */
export const COLLAPSED_OPPONENT_WIDTH_PX = 96;

/** One opponent expanded, the rest collapsed: the accordion focus state. */
export interface AccordionState {
  /** Index (in opponent order) of the expanded column, or `null` for an even
   *  split (e.g. on the local player's turn with nobody hovered/casting). */
  focusedIndex: number | null;
  collapsedWidthPx: number;
}

export function computeBoardLayout(
  width: number,
  height: number,
  opponentCount: number,
  arrangement: BoardArrangement = "row",
  selfHeightFraction: number = SELF_HEIGHT_FRACTION,
  opponentFractions?: number[],
  accordion?: AccordionState,
): BoardLayout {
  const count = Math.max(1, opponentCount);
  const band = Math.min(STRIP_BAND_PX, Math.max(0, height - 2));
  const usable = Math.max(0, height - band);
  const fraction = Math.min(0.8, Math.max(0.2, selfHeightFraction));
  const selfHeight = Math.round(usable * fraction);
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
        { rect: { x: 0, y: 0, width: sideW, height }, orientation: "left" },
        { rect: { x: sideW, y: 0, width: centerW, height: topHeight }, orientation: "top" },
        { rect: { x: width - sideW, y: 0, width: sideW, height }, orientation: "right" },
      ],
      dividerY,
    };
  }

  const opponents: OpponentRegion[] = [];

  if (accordion) {
    // Tiled accordion: the focused column expands to `L - (n-1)·x`, the rest
    // collapse to `x`. With no focus (or no room) they split evenly.
    const x = accordion.collapsedWidthPx;
    const focus = accordion.focusedIndex;
    const hasFocus = focus !== null && focus >= 0 && focus < count && width >= x * count;
    let acc = 0;
    for (let i = 0; i < count; i++) {
      const w = !hasFocus ? width / count : i === focus ? width - x * (count - 1) : x;
      const px = Math.round(acc);
      acc += w;
      opponents.push({
        rect: { x: px, y: 0, width: Math.round(acc) - px, height: topHeight },
        orientation: "top",
      });
    }
  } else {
    // Column widths default to equal; an explicit per-opponent fraction set
    // (from the resize grips) overrides, normalized + floored so a column can't
    // collapse.
    let fractions: number[];
    if (opponentFractions && opponentFractions.length === count) {
      const floored = opponentFractions.map((f) => Math.max(0.1, f));
      const sum = floored.reduce((a, b) => a + b, 0);
      fractions = floored.map((f) => f / sum);
    } else {
      fractions = Array.from({ length: count }, () => 1 / count);
    }
    const widths = fractions.map((f) => f * width);
    let acc = 0;
    for (let i = 0; i < count; i++) {
      const x = Math.round(acc);
      acc += widths[i]!;
      opponents.push({
        rect: { x, y: 0, width: Math.round(acc) - x, height: topHeight },
        orientation: "top",
      });
    }
  }

  return {
    self: { x: 0, y: topHeight + band, width, height: selfHeight },
    opponents,
    dividerY,
  };
}
