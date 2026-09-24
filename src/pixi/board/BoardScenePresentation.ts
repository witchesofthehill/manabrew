import type { Application, Container } from "pixi.js";
import type { GameCanvasCallbacks, PlayZoneRect } from "../types";
import type { DragHandler } from "../DragHandler";
import type { PhaseStripLayer } from "../PhaseStripLayer";
import type { PlayerHudLayer } from "../hud/PlayerHudLayer";
import type { BlockingRect } from "./types";
import type { BoardRegionPresentation } from "./BoardRegionPresentation";
import type { HandController } from "./HandController";

export interface BoardScenePresentation {
  readonly region: BoardRegionPresentation;
  readonly opponentHudHeight: number;
  readonly selfHudHeight: number;
  readonly hudMaxWidth: number;
  readonly hudMinWidth: number;
  readonly cardHeight: number;
  configurePlayerBars(layer: PlayerHudLayer): void;
  configurePhaseStrip(layer: PhaseStripLayer): void;
  configureHand(hand: HandController): void;
  hudUsesColumn(fieldWidth: number): boolean;
  overlayUsesManaGrid(): boolean;
  selectionBadgeX(zone: PlayZoneRect, badgeWidth: number): number;
  selfHudHandBlocker(hand: HandController | null): BlockingRect | null;
  initializeHand(root: Container, callbacks: GameCanvasCallbacks, app: Application): void;
  syncHand(hand: HandController | null, dragHandler: DragHandler, peek: boolean): void;
  setHandOpen(open: boolean): boolean;
  setHandControlBlocker(blocker: BlockingRect | null): boolean;
  handBounds(hand: HandController | null): BlockingRect | null;
  handReserveBottom(hand: HandController | null, zone: PlayZoneRect | null): number;
  localBlockers(
    hand: HandController | null,
    zone: PlayZoneRect | null,
    root: Container,
  ): BlockingRect[];
  localHandReserve(handReserveBottom: number): number;
  setHandExclusion(dragHandler: DragHandler, rect: BlockingRect | null, peek: boolean): void;
}
