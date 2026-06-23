/**
 * Pure helpers for the battlefield grid layout. Cells are sized from the
 * card footprint (CARD_W × CARD_H) scaled by the user's battlefield card
 * scale preference, plus GAP on one side. Blocked cells are any cell whose
 * footprint intersects an overlay keep-out rect (hand, PASS cluster, etc.).
 */

import { CARD_W, CARD_H } from "@/components/game/game.constants";
import {
  GAP,
  BATTLEFIELD_MIN_ROWS,
  BATTLEFIELD_MAX_ROWS,
  BATTLEFIELD_CARD_SCALE_FLOOR,
} from "./constants";
import type { PlayZoneRect } from "./types";

export interface GridBlocker {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GridCell {
  col: number;
  row: number;
  /** Top-left corner of the card footprint inside this cell. */
  x: number;
  y: number;
  /** Center of the card footprint — what sprite targetX/targetY use. */
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
  /** Flat cells array, col-major: index = col * rows + row. */
  cells: GridCell[];
}

export const cellKey = (col: number, row: number): string => `${col},${row}`;

/** Inverse of the `rows` formula in `computeGridLayout` — keep in sync. The
 *  0.5px shave keeps the result just under the `floor()` boundary so the row
 *  count never lands one short. */
export const maxScaleForRows = (usableH: number, rows: number): number => {
  const cellH = (usableH + GAP) / rows - 0.5;
  return (cellH - GAP) / (CARD_H * (1 + CELL_BREATHING_FRAC));
};

export const battlefieldScaleForFraction = (usableH: number, fraction: number): number => {
  const f = Math.min(1, Math.max(0, fraction));
  const floor = BATTLEFIELD_CARD_SCALE_FLOOR;
  const maxScale = Math.max(floor, maxScaleForRows(usableH, BATTLEFIELD_MIN_ROWS));
  const minScale = Math.max(
    floor,
    Math.min(maxScale, maxScaleForRows(usableH, BATTLEFIELD_MAX_ROWS)),
  );
  return minScale + f * (maxScale - minScale);
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
): GridLayoutInfo => {
  const cardW = CARD_W * cardScale;
  const cardH = CARD_H * cardScale;
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
  // Force odd column count so there's always a true center column,
  // keeping the first card aligned with the board's visual center.
  if (cols > 1 && cols % 2 === 0) cols -= 1;
  const rows = Math.max(1, Math.floor((usableH + GAP) / cellH));

  const gridH = rows * cellH - GAP;
  // Center the middle column's card center on the zone's visual center
  // (aligned with the phase strip combat cell). The middle column index
  // is (cols-1)/2 since cols is always odd.
  const zoneCenterX = zone.x + zone.width / 2;
  const midCol = (cols - 1) / 2;
  // Card center for midCol: originX + midCol * cellW + cardW/2 = zoneCenterX
  const originX = zoneCenterX - midCol * cellW - cardW / 2;
  const topMargin = Math.max(0, (usableH - gridH) / 2);
  const originY = zone.y + topMargin;

  const cells: GridCell[] = new Array(cols * rows);
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const x = originX + col * cellW;
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
    cellW,
    cellH,
    cols,
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
