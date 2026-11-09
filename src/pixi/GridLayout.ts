/**
 * Pure helpers for the battlefield grid layout. Cells are sized from the
 * configured card footprint scaled by the user's battlefield card scale
 * preference, plus GAP on one side. Blocked cells are any cell whose
 * footprint intersects an overlay keep-out rect (hand, PASS cluster, etc.).
 */

import { CARD_W, CARD_H } from "@/components/game/game.constants";
import {
  GAP,
  BATTLEFIELD_MIN_ROWS,
  BATTLEFIELD_MIN_ROWS_LARGEST,
  BATTLEFIELD_CARD_SCALE_FLOOR,
  COMBAT_ROW_PAD_Y,
  COMBAT_STAGE_PADDING_PX,
} from "./constants";
import type { PlayZoneRect } from "./types";

export type GridAnchor = "top" | "center" | "bottom";

export interface GridBlocker {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridCell {
  col: number;
  row: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  blocked: boolean;
}

export interface GridLayoutInfo {
  zone: PlayZoneRect;
  cardW: number;
  cardH: number;
  cellW: number;
  cellH: number;
  cols: number;
  rows: number;
  originX: number;
  originY: number;
  cells: GridCell[];
}

export const cellKey = (col: number, row: number): string => `${col},${row}`;

/** Inverse of the `rows` formula in `computeGridLayout` — keep in sync. The
 *  0.5px shave keeps the result just under the `floor()` boundary so the row
 *  count never lands one short. */
export const maxScaleForRows = (
  usableH: number,
  rows: number,
  cardHeight: number = CARD_H,
): number => {
  const cellH = (usableH + GAP) / rows - 0.5;
  return (cellH - GAP) / (cardHeight * (1 + CELL_BREATHING_FRAC));
};

/** Scale at which `rows` whole rows plus one card-height band (card height
 *  plus `COMBAT_ROW_PAD_Y * 2 + COMBAT_STAGE_PADDING_PX`) exactly fill
 *  `usableH`. Desktop sizes cards with this solve so the band survives as free
 *  grid headroom; attackers stage across the seam instead of inside it. */
export const scaleForRowsWithCombatRow = (usableH: number, rows: number): number => {
  const bandFixed = COMBAT_ROW_PAD_Y * 2 + COMBAT_STAGE_PADDING_PX;
  return (
    (usableH - bandFixed + GAP - rows * (0.5 + GAP)) /
    (CARD_H * ((1 + CELL_BREATHING_FRAC) * rows + 1))
  );
};

/** Scale at which `rows` whole rows plus half of the shared seam lane (half a
 *  card height plus `COMBAT_ROW_PAD_Y`) exactly fill `usableH`, measured from
 *  the seam. */
export const scaleForRowsWithHalfLane = (usableH: number, rows: number): number =>
  (usableH - COMBAT_ROW_PAD_Y + GAP - rows * (0.5 + GAP)) /
  (CARD_H * ((1 + CELL_BREATHING_FRAC) * rows + 0.5));

/** Card scale for the user's size multiplier: 1 (100%) is the largest size
 *  that fits `BATTLEFIELD_MIN_ROWS` rows in the grid area below the lane, and
 *  the multiplier grows the cards continuously from there, clamped to a
 *  `BATTLEFIELD_MIN_ROWS_LARGEST`-row fill so the board never degrades below
 *  that row count. */
export const battlefieldScaleForMultiplier = (
  gridH: number,
  fromSeam: number,
  multiplier: number,
): number => {
  const fit = (rows: number) =>
    Math.min(maxScaleForRows(gridH, rows), scaleForRowsWithHalfLane(fromSeam, rows));
  const base = fit(BATTLEFIELD_MIN_ROWS);
  const max = fit(BATTLEFIELD_MIN_ROWS_LARGEST);
  return Math.max(BATTLEFIELD_CARD_SCALE_FLOOR, Math.min(base * multiplier, max));
};

/**
 * Extra breathing space added to each cell footprint on top of the GAP.
 * Tapped cards rotate 90° around their center and briefly stick out past
 * the card's upright footprint on the sides; this small cushion stops
 * neighbouring cards from kissing when one of them taps.
 */
const CELL_BREATHING_FRAC = 0.12;

export const computeGridLayout = (
  zone: PlayZoneRect,
  leftReserved: number,
  blockers: GridBlocker[],
  cardScale: number,
  leftAlign = false,
  cardHeight: number = CARD_H,
  anchor: GridAnchor = "center",
  reservedTrailingCols = 0,
): GridLayoutInfo => {
  const cardW = CARD_W * cardScale;
  const cardH = cardHeight * cardScale;
  const breathingW = cardW * CELL_BREATHING_FRAC;
  const breathingH = cardH * CELL_BREATHING_FRAC;
  const cellW = cardW + GAP + breathingW;
  const cellH = cardH + GAP + breathingH;
  const leftPad = Math.max(0, leftReserved);
  // Grid spans the entire play zone; exclusion zones (hand fan, stack,
  // PASS) are communicated as `blockers` and mark out individual cells
  // whose footprint would intersect them.
  const usableW = Math.max(cardW, zone.width - leftPad);
  const usableH = Math.max(cardH, zone.height);
  let cols = Math.max(1, Math.floor((usableW + GAP) / cellW));
  // Force odd column count so there's always a true center column, keeping the
  // first card aligned with the board's visual center. Left-aligned grids have
  // no center to preserve, so they keep every column.
  if (!leftAlign && cols > 1 && cols % 2 === 0) cols -= 1;
  const rows = Math.max(1, Math.floor((usableH + GAP) / cellH));

  const gridH = rows * cellH - GAP;
  // Justify columns: the leftover width widens every gap so the outer cards
  // sit on the usable edges. With an odd count this also puts the middle
  // column's card center on the zone's visual center.
  const strideX = cols > 1 ? Math.max(cellW, (usableW - cardW) / (cols - 1)) : cellW;
  const gridW = (cols - 1) * strideX + cardW;
  const originX = zone.x + leftPad + Math.max(0, (usableW - gridW) / 2);
  const freeH = Math.max(0, usableH - gridH);
  const topMargin = anchor === "top" ? 0 : anchor === "bottom" ? freeH : freeH / 2;
  const originY = zone.y + topMargin;

  const placedCols = Math.max(1, cols - reservedTrailingCols);
  const cells: GridCell[] = new Array(placedCols * rows);
  for (let col = 0; col < placedCols; col++) {
    for (let row = 0; row < rows; row++) {
      const x = originX + col * strideX;
      const y = originY + row * cellH;
      // A cell is blocked when its full footprint overlaps any keep-out
      // rect. This is the strict test — if the card can't fit entirely
      // outside the blocker the cell is unavailable. It costs us cells in
      // corridors narrower than a card width, but it guarantees no card
      // ever lands under the hand, stack panel, or PASS cluster.
      const blocked = blockers.some(
        (b) => x < b.x + b.width && x + cardW > b.x && y < b.y + b.height && y + cardH > b.y,
      );
      cells[col * rows + row] = {
        col,
        row,
        x,
        y,
        cx: x + cardW / 2,
        cy: y + cardH / 2,
        blocked,
      };
    }
  }

  return {
    zone,
    cardW,
    cardH,
    cellW: strideX,
    cellH,
    cols: placedCols,
    rows,
    originX,
    originY,
    cells,
  };
};

export const cellAt = (info: GridLayoutInfo, col: number, row: number): GridCell | null => {
  if (col < 0 || col >= info.cols || row < 0 || row >= info.rows) return null;
  return info.cells[col * info.rows + row] ?? null;
};

export const cellFromPoint = (info: GridLayoutInfo, px: number, py: number): GridCell | null => {
  const rawCol = Math.round((px - info.originX - info.cardW / 2) / info.cellW);
  const rawRow = Math.round((py - info.originY - info.cardH / 2) / info.cellH);
  const col = Math.max(0, Math.min(info.cols - 1, rawCol));
  const row = Math.max(0, Math.min(info.rows - 1, rawRow));
  return cellAt(info, col, row);
};

export const dropCellFromPoint = (
  info: GridLayoutInfo,
  px: number,
  py: number,
): GridCell | null => {
  if (
    px < info.zone.x ||
    px > info.zone.x + info.zone.width ||
    py < info.zone.y ||
    py > info.zone.y + info.zone.height
  ) {
    return null;
  }
  const cell = cellFromPoint(info, px, py);
  return cell && !cell.blocked ? cell : null;
};

/**
 * All cells sorted by distance from (tx, ty). Blocked cells can be filtered
 * by the caller. Used to pick the nearest-free slot to a preferred anchor
 * (center, bottom-center, etc).
 */
export const cellsByDistance = (info: GridLayoutInfo, tx: number, ty: number): GridCell[] =>
  [...info.cells].sort((a, b) => {
    const da = (a.cx - tx) * (a.cx - tx) + (a.cy - ty) * (a.cy - ty);
    const db = (b.cx - tx) * (b.cx - tx) + (b.cy - ty) * (b.cy - ty);
    return da - db;
  });
