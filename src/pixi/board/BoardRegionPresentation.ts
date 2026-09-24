import type { CardDto } from "@/protocol/game";
import type { CardSprite } from "../CardSprite";
import type { PlayZoneRect } from "../types";
import type { BlockingRect } from "./types";

export interface BoardRegionPoint {
  x: number;
  y: number;
}

export interface BoardRegionPresentation {
  readonly cardHeight: number;
  configureSprite(sprite: CardSprite): void;
  zoneTilesDraggable(mirrored: boolean, locked: boolean): boolean;
  ignoreZoneTileBlockers(mirrored: boolean): boolean;
  gridBottomAnchored(mirrored: boolean): boolean;
  localBlockers(mirrored: boolean, blockers: BlockingRect[]): BlockingRect[];
  gridRows(rowCount: number, mirrored: boolean): number[];
  storedZoneSlot(
    key: string,
    slots: ReadonlyMap<string, { col: number; row: number }>,
  ): { col: number; row: number } | undefined;
  rememberZoneSlot(
    key: string,
    slot: { col: number; row: number },
    slots: Map<string, { col: number; row: number }>,
  ): void;
  frontEdgeY(
    zone: PlayZoneRect,
    mirrored: boolean,
    cardScale: number,
    combatRowPadding: number,
  ): number;
  compressLands(
    cards: CardDto[],
    positions: Map<string, BoardRegionPoint>,
    cardWidth: number,
    zoneCenterX: number,
    userPlacedCards: ReadonlySet<string>,
  ): void;
  playAreaZone(zone: PlayZoneRect, usableZone: PlayZoneRect, mirrored: boolean): PlayZoneRect;
  gridSkeletonAlpha(): { stroke: number; fill: number };
}
