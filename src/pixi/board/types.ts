import type { Container, FederatedPointerEvent } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import type { CardSprite } from "../CardSprite";
import type { BattlefieldState, GameCanvasCallbacks } from "../types";

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
