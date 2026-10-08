import { CARD_H } from "@/components/game/game.constants";
import type { CardDto } from "@/protocol/game";
import type { CardSprite } from "../CardSprite";
import { GRID_SKELETON_FILL_ALPHA, GRID_SKELETON_STROKE_ALPHA } from "../constants";
import type { PlayZoneRect } from "../types";
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

  gridBottomAnchored(): boolean {
    return false;
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

  frontEdgeY(
    zone: PlayZoneRect,
    mirrored: boolean,
    cardScale: number,
    combatRowPadding: number,
  ): number {
    const halfCard = (this.cardHeight * cardScale) / 2;
    return mirrored
      ? zone.y + zone.height - combatRowPadding - halfCard
      : zone.y + combatRowPadding + halfCard;
  }

  compressLands(
    _cards: CardDto[],
    _positions: Map<string, BoardRegionPoint>,
    _cardWidth: number,
    _zoneCenterX: number,
    _userPlacedCards: ReadonlySet<string>,
  ): void {}

  playAreaZone(_zone: PlayZoneRect, usableZone: PlayZoneRect): PlayZoneRect {
    return usableZone;
  }

  gridSkeletonAlpha(): { stroke: number; fill: number } {
    return { stroke: GRID_SKELETON_STROKE_ALPHA, fill: GRID_SKELETON_FILL_ALPHA };
  }
}
