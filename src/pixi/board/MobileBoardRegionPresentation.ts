import { CARD_W } from "@/components/game/game.constants";
import type { CardDto } from "@/protocol/game";
import type { CardSprite } from "../CardSprite";
import {
  COMPACT_LAND_OVERLAP_MIN,
  COMPACT_LAND_STEP_FRAC,
  GRID_SKELETON_FILL_ALPHA_COMPACT,
  GRID_SKELETON_STROKE_ALPHA_COMPACT,
} from "../constants";
import type { PlayZoneRect } from "../types";
import type { BoardRegionPoint, BoardRegionPresentation } from "./BoardRegionPresentation";
import type { BlockingRect } from "./types";

export class MobileBoardRegionPresentation implements BoardRegionPresentation {
  readonly cardHeight = CARD_W;

  configureSprite(sprite: CardSprite): void {
    sprite.setCompactSquare(true);
  }

  zoneTilesDraggable(): boolean {
    return false;
  }

  ignoreZoneTileBlockers(mirrored: boolean): boolean {
    return !mirrored;
  }

  gridBottomAnchored(mirrored: boolean): boolean {
    return !mirrored;
  }

  localBlockers(mirrored: boolean, blockers: BlockingRect[]): BlockingRect[] {
    return mirrored ? blockers : [];
  }

  gridRows(rowCount: number): number[] {
    return Array.from({ length: rowCount }, (_, row) => row);
  }

  storedZoneSlot(): undefined {
    return undefined;
  }

  rememberZoneSlot(): void {}

  frontEdgeY(zone: PlayZoneRect, mirrored: boolean): number {
    return mirrored ? zone.y + zone.height : zone.y;
  }

  compressLands(
    cards: CardDto[],
    positions: Map<string, BoardRegionPoint>,
    cardWidth: number,
    zoneCenterX: number,
    userPlacedCards: ReadonlySet<string>,
  ): void {
    const lands = cards
      .filter((card) => card.types.includes("Land") && positions.has(card.id))
      .sort((left, right) => positions.get(left.id)!.x - positions.get(right.id)!.x);
    if (
      lands.length < COMPACT_LAND_OVERLAP_MIN ||
      lands.some((card) => userPlacedCards.has(card.id))
    ) {
      return;
    }
    const step = cardWidth * COMPACT_LAND_STEP_FRAC;
    const startX = zoneCenterX - (step * (lands.length - 1)) / 2;
    for (let index = 0; index < lands.length; index++) {
      positions.get(lands[index]!.id)!.x = startX + step * index;
    }
  }

  playAreaZone(zone: PlayZoneRect, _usableZone: PlayZoneRect, mirrored: boolean): PlayZoneRect {
    return mirrored ? _usableZone : zone;
  }

  gridSkeletonAlpha(): { stroke: number; fill: number } {
    return {
      stroke: GRID_SKELETON_STROKE_ALPHA_COMPACT,
      fill: GRID_SKELETON_FILL_ALPHA_COMPACT,
    };
  }
}
