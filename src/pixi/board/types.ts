import type { Container, FederatedPointerEvent } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import type { CardDto } from "@/protocol/game";
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

/** One combatant blocker pulled to its region's front edge, aligned beneath
 *  the attacker it blocks. `laneScreenX` is the attacker's on-screen x
 *  (absolute viewport px), converted to canvas-local. Multiple blockers on
 *  one attacker fan out by index. */
export interface StagedBlocker {
  id: string;
  laneScreenX: number;
  /** The attacker's canvas-local y, so the blocker slides up onto it (crossing
   *  the phase bar) rather than stopping at its own region's front edge. */
  attackerY: number;
  indexInLane: number;
  laneCount: number;
}

/** style combat layout for the cards in one region. Attackers slide
 *  forward keeping their x; blockers slide to their attacker's lane. Set
 *  null to release (cards lerp home). */
export interface SceneCombatStaging {
  attackerIds: Set<string>;
  blockers: StagedBlocker[];
  blockerIds: Set<string>;
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
  card: CardDto;
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
  /** Lerp state for the base (card + hover) scale, kept separate from the
   *  sprite's live scale so the entrance squash multiplier can compose with it. */
  scaleBase: number;
  /** Frames of damage-shake jitter remaining (0 = not shaking). */
  shakeFrames: number;
  /** A freshly-entered card awaiting its landing stomp — fired once it lerps
   *  onto its battlefield slot (not at spawn, while it's still sliding in). */
  pendingEntrance: boolean;
  /** True while the card is fading out after leaving the battlefield. */
  exiting?: boolean;
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

/** Narrow seam a `BoardRegion` uses to reach orchestrator-level services
 *  (theme, keep-out blockers, card-entry seeds, selection, overlay, sprite
 *  event wiring) without owning them. */
export interface RegionHost {
  getTheme(): Theme;
  /** Keep-out rects for this region (hand fan + panel reserves). */
  collectBlockers(): BlockingRect[];
  /** Seed transform for a newly-entering battlefield sprite (mirror of a
   *  hand sprite / stack card / hand-fan origin). */
  getEntrySeed(cardId: string): { x: number; y: number; scaleX: number; scaleY: number };
  isSelected(cardId: string): boolean;
  rebuildOverlay(entry: SpriteEntry, state: BattlefieldState): void;
  /** Wire pointer events (drag/tap/hover) on a new battlefield sprite. */
  wireSprite(sprite: CardSprite): void;
  /** Convert an absolute viewport x to this region's canvas-local x. */
  screenXToLocalX(screenX: number): number;
  /** Px to trim off the bottom of this region's felt so it clears the hand
   *  fan (local player only; 0 for opponents). */
  getHandReserveBottom(): number;
  /** Spawn a rising/fading number at a canvas-space point (combat damage). */
  spawnFloatingText(canvasX: number, canvasY: number, content: string, color: number): void;
  isDestroyed(): boolean;
}

/** Narrow seam the `SelectionController` uses to read battlefield sprites
 *  and re-apply the base (non-selected) ring colour. */
export interface SelectionHost {
  getPlayZone(): PlayZoneRect;
  getTheme(): Theme;
  getEntries(): ReadonlyMap<string, SpriteEntry>;
  applyRing(sprite: CardSprite): void;
  canRefreshRings(): boolean;
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
