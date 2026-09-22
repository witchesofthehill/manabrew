import { Point, type Application, type Container } from "pixi.js";
import { CARD_H } from "@/components/game/game.constants";
import type { GameCanvasCallbacks, PlayZoneRect } from "../types";
import type { DragHandler } from "../DragHandler";
import { HAND_RESERVE_TRIM } from "../constants";
import {
  OPPONENT_PLAYER_HUD_HEIGHT_PX,
  SELF_PLAYER_HUD_HEIGHT_PX,
  SELF_PLAYER_HUD_MAX_WIDTH_PX,
  SELF_PLAYER_HUD_MIN_WIDTH_PX,
  type PlayerHudLayer,
} from "../hud/PlayerHudLayer";
import type { PhaseStripLayer } from "../PhaseStripLayer";
import { DesktopBoardRegionPresentation } from "./DesktopBoardRegionPresentation";
import type { BoardScenePresentation } from "./BoardScenePresentation";
import type { HandController } from "./HandController";
import type { BlockingRect } from "./types";

export class DesktopBoardScenePresentation implements BoardScenePresentation {
  private readonly scratchA = new Point();
  private readonly scratchB = new Point();

  readonly region = new DesktopBoardRegionPresentation();
  readonly opponentHudHeight = OPPONENT_PLAYER_HUD_HEIGHT_PX;
  readonly selfHudHeight = SELF_PLAYER_HUD_HEIGHT_PX;
  readonly hudMaxWidth = SELF_PLAYER_HUD_MAX_WIDTH_PX;
  readonly hudMinWidth = SELF_PLAYER_HUD_MIN_WIDTH_PX;
  readonly cardHeight = CARD_H;

  configurePlayerBars(layer: PlayerHudLayer): void {
    layer.setCompact(false);
  }

  configurePhaseStrip(layer: PhaseStripLayer): void {
    layer.setCompact(false);
    layer.container.visible = true;
  }

  configureHand(hand: HandController): void {
    hand.setCompact(false);
  }

  hudUsesColumn(fieldWidth: number): boolean {
    return fieldWidth < 228;
  }
  overlayUsesManaGrid(): boolean {
    return true;
  }

  selectionBadgeX(zone: PlayZoneRect, badgeWidth: number): number {
    return zone.x + zone.width - badgeWidth - 8;
  }

  selfHudHandBlocker(hand: HandController | null): BlockingRect | null {
    return hand?.getBlockerRect() ?? null;
  }
  initializeHand(_root: Container, _callbacks: GameCanvasCallbacks, _app: Application): void {}

  syncHand(hand: HandController | null, dragHandler: DragHandler): void {
    hand?.setSheetOpen(false);
    hand?.setPeek(false);
    if (hand) hand.container.visible = true;
    dragHandler.setHandExclusion(hand?.getBlockerRect() ?? null);
  }

  setHandOpen(): boolean {
    return false;
  }

  setHandControlBlocker(): boolean {
    return false;
  }

  handBounds(hand: HandController | null): BlockingRect | null {
    return hand?.getBlockerRect() ?? null;
  }

  handReserveBottom(hand: HandController | null, zone: PlayZoneRect | null): number {
    const rect = hand?.getBlockerRect();
    if (!rect || !zone) return 0;
    return Math.max(0, zone.y + zone.height - rect.y);
  }

  localBlockers(
    hand: HandController | null,
    zone: PlayZoneRect | null,
    root: Container,
  ): BlockingRect[] {
    const handRect = hand?.getBlockerRect();
    if (!handRect) return [];
    const bottom = zone ? zone.y + zone.height : handRect.y + handRect.height;
    const top = bottom - Math.max(0, bottom - handRect.y) * HAND_RESERVE_TRIM;
    const topLeft = root.toGlobal(this.scratchA.set(handRect.x, top), this.scratchA);
    const bottomRight = root.toGlobal(
      this.scratchB.set(handRect.x + handRect.width, handRect.y + handRect.height),
      this.scratchB,
    );
    return [
      {
        x: topLeft.x,
        y: topLeft.y,
        width: bottomRight.x - topLeft.x,
        height: bottomRight.y - topLeft.y,
      },
    ];
  }

  localHandReserve(handReserveBottom: number): number {
    return handReserveBottom * HAND_RESERVE_TRIM;
  }

  setHandExclusion(dragHandler: DragHandler, rect: BlockingRect | null, _peek: boolean): void {
    dragHandler.setHandExclusion(rect);
  }
}
