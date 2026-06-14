import type { Container, FederatedPointerEvent } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import type { GameCard } from "@/types/manabrew";
import type { CardSprite } from "../CardSprite";
import type { BattlefieldState, GameCanvasCallbacks, PlayZoneRect } from "../types";

/** Canvas-coordinate keep-out rectangle (hand fan, panels, etc.) the grid
 *  layout treats as blocked. */
export interface BlockingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Per-frame animation target for a hand-fan sprite. */
export interface HandTarget {
  x: number;
  y: number;
  rot: number;
  scaleX: number;
  scaleY: number;
  zIndex: number;
}

/** Hit rectangle + card for one hand-fan slot (cursor → card resolution). */
export interface HandHitZone {
  index: number;
  card: GameCard;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A single battlefield card's sprite plus its animation targets and the
 *  lazily-created action overlay (tap/untap/mana buttons). */
export interface SpriteEntry {
  sprite: CardSprite;
  targetX: number;
  targetY: number;
  targetZIndex: number;
  targetRotation: number;
  etbGlowAlpha: number;
  overlay: Container | null;
}

/** Narrow seam the `BattlefieldOverlay` uses to read scene state and drive
 *  hover/drag without owning it. The scene supplies this (its getters reach
 *  the scene's private fields by closure). */
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

/** Narrow seam the `HandController` uses to read scene geometry/state and
 *  feed the drag-exclusion band, without owning the scene. */
export interface HandHost {
  getPlayZone(): PlayZoneRect;
  getCallbacks(): GameCanvasCallbacks;
  getTheme(): Theme;
  isMirrored(): boolean;
  showsHand(): boolean;
  isDestroyed(): boolean;
  setHandExclusion(rect: BlockingRect | null): void;
}
