import { CARD_H, CARD_W } from "@/components/game/game.constants";
import type { CardDto } from "@/protocol/game";
import type { CardSprite } from "../CardSprite";
import {
  COMBAT_ROW_PAD_Y,
  GRID_SKELETON_FILL_ALPHA,
  GRID_SKELETON_STROKE_ALPHA,
} from "../constants";
import type { GridAnchor } from "../GridLayout";
import type { PlayZoneRect } from "../types";
import { playmatGridArea } from "./PlaymatLayer";
import type { BoardRegionPoint, BoardRegionPresentation } from "./BoardRegionPresentation";
import type { BlockingRect } from "./types";

export class DesktopBoardRegionPresentation implements BoardRegionPresentation {
  readonly cardHeight = CARD_H;

  configureSprite(sprite: CardSprite): void {
    sprite.setCompactSquare(false);
  }

  zoneTilesDraggable(mirrored: boolean, locked: boolean): boolean {
    return !mirrored && !locked;
  }

  gridAnchor(mirrored: boolean): GridAnchor {
    return mirrored ? "bottom" : "top";
  }
  ignoreZoneTileBlockers(): boolean {
    return false;
  }

  localBlockers(_mirrored: boolean, blockers: BlockingRect[]): BlockingRect[] {
    return blockers;
  }

  gridRows(rowCount: number, mirrored: boolean): number[] {
    const rows = Array.from({ length: rowCount }, (_, row) => row);
    return mirrored ? rows : rows.reverse();
  }

  storedZoneSlot(
    key: string,
    slots: ReadonlyMap<string, { col: number; row: number }>,
  ): { col: number; row: number } | undefined {
    return slots.get(key);
  }

  rememberZoneSlot(
    key: string,
    slot: { col: number; row: number },
    slots: Map<string, { col: number; row: number }>,
  ): void {
    slots.set(key, slot);
  }

  frontEdgeY(zone: PlayZoneRect, mirrored: boolean): number {
    return mirrored ? zone.y + zone.height : zone.y;
  }

  compressLands(
    _cards: CardDto[],
    _positions: Map<string, BoardRegionPoint>,
    _cardWidth: number,
    _zoneCenterX: number,
    _userPlacedCards: ReadonlySet<string>,
  ): void {}

  playAreaZone(
    zone: PlayZoneRect,
    usableZone: PlayZoneRect,
    mirrored: boolean,
    cardScale: number,
  ): PlayZoneRect {
    const area = playmatGridArea(zone, usableZone, ((CARD_H - CARD_W) * cardScale) / 2);
    const halfLane = (CARD_H * cardScale) / 2 + COMBAT_ROW_PAD_Y;
    if (mirrored) {
      const bottom = Math.min(area.y + area.height, zone.y + zone.height - halfLane);
      return { ...area, height: Math.max(1, bottom - area.y) };
    }
    const top = Math.max(area.y, zone.y + halfLane);
    return { ...area, y: top, height: Math.max(1, area.y + area.height - top) };
  }

  gridSkeletonAlpha(): { stroke: number; fill: number } {
    return { stroke: GRID_SKELETON_STROKE_ALPHA, fill: GRID_SKELETON_FILL_ALPHA };
  }
}
