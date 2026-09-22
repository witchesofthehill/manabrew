import { Container, type Application, type FederatedPointerEvent } from "pixi.js";
import { CARD_W } from "@/components/game/game.constants";
import type { GameCanvasCallbacks, PlayZoneRect } from "../types";
import type { DragHandler } from "../DragHandler";
import { Z_HAND_CONTAINER } from "../constants";
import {
  MOBILE_PLAYER_HUD_HEIGHT_PX,
  MOBILE_PLAYER_HUD_MAX_WIDTH_PX,
  MOBILE_PLAYER_HUD_MIN_WIDTH_PX,
  type PlayerHudLayer,
} from "../hud/PlayerHudLayer";
import type { PhaseStripLayer } from "../PhaseStripLayer";
import { MobileBoardRegionPresentation } from "./MobileBoardRegionPresentation";
import type { BoardScenePresentation } from "./BoardScenePresentation";
import type { HandController } from "./HandController";
import type { BlockingRect } from "./types";

export class MobileBoardScenePresentation implements BoardScenePresentation {
  private handBackdrop: Container | null = null;
  private handOpen = false;
  private handControlBlocker: BlockingRect | null = null;
  private handReserve = 0;

  readonly region = new MobileBoardRegionPresentation();
  readonly opponentHudHeight = MOBILE_PLAYER_HUD_HEIGHT_PX;
  readonly selfHudHeight = MOBILE_PLAYER_HUD_HEIGHT_PX;
  readonly hudMaxWidth = MOBILE_PLAYER_HUD_MAX_WIDTH_PX;
  readonly hudMinWidth = MOBILE_PLAYER_HUD_MIN_WIDTH_PX;
  readonly cardHeight = CARD_W;

  configurePlayerBars(layer: PlayerHudLayer): void {
    layer.setCompact(true);
  }

  configurePhaseStrip(layer: PhaseStripLayer): void {
    layer.setCompact(true);
    layer.container.visible = false;
  }

  configureHand(hand: HandController): void {
    hand.setCompact(true);
  }

  hudUsesColumn(): boolean {
    return false;
  }
  overlayUsesManaGrid(): boolean {
    return false;
  }

  selectionBadgeX(zone: PlayZoneRect, badgeWidth: number): number {
    return zone.x + zone.width / 2 - badgeWidth / 2;
  }

  selfHudHandBlocker(): null {
    return null;
  }
  initializeHand(root: Container, callbacks: GameCanvasCallbacks, app: Application): void {
    const backdrop = new Container();
    backdrop.visible = false;
    backdrop.eventMode = "none";
    backdrop.cursor = "pointer";
    backdrop.zIndex = Z_HAND_CONTAINER - 1;
    backdrop.hitArea = {
      contains: (x, y) => x >= 0 && x <= app.renderer.width && y >= 0 && y <= app.renderer.height,
    };
    backdrop.on("pointerdown", (event: FederatedPointerEvent) => {
      event.stopPropagation();
    });
    backdrop.on("pointertap", () => {
      callbacks.onMobileHandOpenChange?.(false);
    });
    root.addChild(backdrop);
    this.handBackdrop = backdrop;
  }

  syncHand(hand: HandController | null, dragHandler: DragHandler, peek: boolean): void {
    const visiblePeek = peek && !this.handOpen;
    hand?.setSheetOpen(this.handOpen);
    hand?.setPeek(visiblePeek);
    if (hand) hand.container.visible = this.handOpen || visiblePeek;
    if (this.handBackdrop) {
      this.handBackdrop.visible = this.handOpen;
      this.handBackdrop.eventMode = this.handOpen ? "static" : "none";
    }
    const handRect = hand?.getBlockerRect() ?? null;
    dragHandler.setHandExclusion(!this.handOpen && !visiblePeek ? null : handRect);
  }

  setHandOpen(open: boolean): boolean {
    if (this.handOpen === open) return false;
    this.handOpen = open;
    return true;
  }

  setHandControlBlocker(blocker: BlockingRect | null): boolean {
    const current = this.handControlBlocker;
    if (blocker) this.handReserve = blocker.height;
    if (
      current?.x === blocker?.x &&
      current?.y === blocker?.y &&
      current?.width === blocker?.width &&
      current?.height === blocker?.height
    ) {
      return false;
    }
    this.handControlBlocker = blocker;
    return true;
  }

  handBounds(hand: HandController | null): BlockingRect | null {
    if (!this.handOpen) return null;
    return hand?.getBlockerRect() ?? null;
  }

  handReserveBottom(_hand: HandController | null, _zone: PlayZoneRect | null): number {
    return 0;
  }

  localBlockers(): BlockingRect[] {
    return this.handControlBlocker ? [this.handControlBlocker] : [];
  }

  localHandReserve(): number {
    return this.handReserve;
  }

  setHandExclusion(dragHandler: DragHandler, rect: BlockingRect | null, peek: boolean): void {
    dragHandler.setHandExclusion(!this.handOpen && !peek ? null : rect);
  }
}
