import type { PlayZoneRect } from "../types";

/** Which screen edge a region's player is seated at. `bottom` is the local
 *  player (upright); `top` opponents are mirrored. */
export type RegionOrientation = "bottom" | "top";

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
  opponentLayout: "focused" | "overview";
}

/** Fixed vertical band, in px, reserved at the center for the phase strip. */
export const STRIP_BAND_PX = 38;

export const STRIP_BAND_COMPACT_PX = 32;

export const COLLAPSED_OPPONENT_WIDTH_PX = 112;

export function collapsedOpponentWidth(width: number, opponentCount: number): number {
  return Math.min(COLLAPSED_OPPONENT_WIDTH_PX, width / (opponentCount + 1));
}

export function computeBoardLayout(
  width: number,
  height: number,
  opponentCount: number,
  selfBottomReserve = 0,
  compact = false,
  opponentLayout: "focused" | "overview" = "focused",
): BoardLayout {
  const count = Math.max(1, opponentCount);
  const bandPx = compact ? STRIP_BAND_COMPACT_PX : STRIP_BAND_PX;
  const band = Math.min(bandPx, Math.max(0, height - 2));
  const usable = Math.max(0, height - band);
  const fraction =
    usable > 0 ? Math.min(0.8, Math.max(0.2, 0.5 + selfBottomReserve / (2 * usable))) : 0.5;
  const minimumTop = Math.min(176, usable * 0.55);
  const selfHeight = Math.min(Math.round(usable * fraction), Math.floor(usable - minimumTop));
  const topHeight = usable - selfHeight;
  const dividerY = topHeight + band / 2;
  const overview = opponentLayout === "overview" && !compact && opponentCount > 1;

  const opponentHeight = overview ? topHeight / count : topHeight;
  const opponents: OpponentRegion[] = [];
  for (let i = 0; i < count; i++) {
    const x = overview ? 0 : i * collapsedOpponentWidth(width, count);
    opponents.push({
      rect: {
        x,
        y: overview ? i * opponentHeight : 0,
        width: Math.max(1, width - x),
        height: opponentHeight,
      },
      orientation: "top",
    });
  }

  return {
    self: { x: 0, y: topHeight + band, width, height: selfHeight },
    opponents,
    dividerY,
    stripBandPx: band,
    opponentLayout: overview ? "overview" : "focused",
  };
}
