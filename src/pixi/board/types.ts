import type { Container, FederatedPointerEvent } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import type { GameCard } from "@/types/manabrew";
import type { CardSprite } from "../CardSprite";
import type { BattlefieldState, GameCanvasCallbacks, PlayZoneRect } from "../types";

export interface BlockingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StagedBlocker {
  id: string;
  laneScreenX: number;
  attackerY: number;
  indexInLane: number;
  laneCount: number;
}

export interface SceneCombatStaging {
  attackerIds: Set<string>;
  blockers: StagedBlocker[];
  blockerIds: Set<string>;
}

export interface HandTarget {
  x: number;
  y: number;
  rot: number;
  scaleX: number;
  scaleY: number;
  zIndex: number;
}

export interface HandHitZone {
  index: number;
  card: GameCard;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteEntry {
  sprite: CardSprite;
  targetX: number;
  targetY: number;
  targetZIndex: number;
  targetRotation: number;
  etbGlowAlpha: number;
  scaleBase: number;
  shakeFrames: number;
  exiting?: boolean;
  overlay: Container | null;
}

export interface OverlayHost {
  getTheme(): Theme;
  getCallbacks(): GameCanvasCallbacks;
  getContainer(): Container;
  getSelectedCardIds(): ReadonlySet<string>;
  getLastState(): BattlefieldState | null;
  getEntries(): ReadonlyMap<string, SpriteEntry>;
  isJustDragged(cardId: string): boolean;
  startCardDrag(sprite: CardSprite, e: FederatedPointerEvent): void;
  cancelHoverClear(): void;
  setCardHovered(sprite: CardSprite): void;
  scheduleHoverClear(cardId: string): void;
}

export interface RegionHost {
  getTheme(): Theme;
  collectBlockers(): BlockingRect[];
  getEntrySeed(cardId: string): { x: number; y: number; scaleX: number; scaleY: number };
  isSelected(cardId: string): boolean;
  rebuildOverlay(entry: SpriteEntry, state: BattlefieldState): void;
  wireSprite(sprite: CardSprite): void;
  screenXToLocalX(screenX: number): number;
  getHandReserveBottom(): number;
  spawnFloatingText(canvasX: number, canvasY: number, content: string, color: number): void;
  isDestroyed(): boolean;
}

export interface SelectionHost {
  getPlayZone(): PlayZoneRect;
  getTheme(): Theme;
  getEntries(): ReadonlyMap<string, SpriteEntry>;
  applyRing(sprite: CardSprite): void;
  canRefreshRings(): boolean;
}

export interface HandHost {
  getPlayZone(): PlayZoneRect;
  getCallbacks(): GameCanvasCallbacks;
  getTheme(): Theme;
  isMirrored(): boolean;
  showsHand(): boolean;
  isDestroyed(): boolean;
  setHandExclusion(rect: BlockingRect | null): void;
}
