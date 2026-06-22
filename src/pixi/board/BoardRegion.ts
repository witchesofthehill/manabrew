import { Container, Graphics, Text, type FederatedPointerEvent } from "pixi.js";
import type { GameCard } from "@/types/manabrew";
import { CardSprite } from "../CardSprite";
import type { BattlefieldState, PlayZoneRect, ScreenPos } from "../types";
import {
  cellAt,
  cellFromPoint,
  cellKey,
  cellsByDistance,
  computeGridLayout,
  type GridCell,
  type GridLayoutInfo,
} from "../GridLayout";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import { hexToNum } from "../colorUtils";
import { EMPTY_LABEL_STYLE } from "../textStyles";
import { lerp, safeDestroy } from "./pixiHelpers";
import { EffectsLayer } from "../effects/EffectsLayer";
import { playStomp } from "../effects/stomp";
import { animationsEnabled } from "../effects/enabled";
import {
  applyCardOverrides,
  useGameDevStore,
  DEBUG_KEYWORD_CARD_ID,
} from "@/stores/useGameDevStore";
import {
  ATTACH_OFFSET_Y,
  BATTLEFIELD_LERP,
  BG_ALPHA_DROP,
  BG_ALPHA_IDLE,
  CARD_RADIUS,
  COMBAT_DIM_ALPHA,
  COMBAT_DIM_TINT_LEVEL,
  DAMAGE_SHAKE_AMP_PX,
  DAMAGE_SHAKE_FRAMES,
  EXIT_FADE_LERP,
  EXIT_SHRINK,
  GAP,
  COMBAT_BLOCKER_OVERLAP_FRAC,
  COMBAT_STAGE_FAN_FRAC,
  COMBAT_STAGE_PADDING_PX,
  COMBAT_STAGE_SELF_EXTRA_PX,
  GRID_SKELETON_FILL_ALPHA,
  GRID_SKELETON_HOVER_ALPHA,
  GRID_SKELETON_STACK_ALPHA,
  GRID_SKELETON_STACK_FILL_ALPHA,
  GRID_SKELETON_STROKE_ALPHA,
  HOVER_SCALE,
  HOVER_SCALE_LERP,
  MAX_GRID_SLOTS,
  MAX_LAND_SLOTS,
  OVERLAY_FADE_LERP,
  ROTATION_LERP,
  SNAP_ALPHA,
  SNAP_PX,
  SNAP_ROT,
  SNAP_SCALE,
  STACK_MAX_SLIDE_CARDS,
  TABLE_RADIUS,
  Z_COMBAT_STAGED,
  Z_GRID_SKELETON,
  Z_OVERLAY_OFFSET,
} from "../constants";
import type { BlockingRect, RegionHost, SceneCombatStaging, SpriteEntry } from "./types";
import { STRIP_BAND_PX, type RegionOrientation } from "./boardLayout";

type Point = ScreenPos;

interface BoardRegionOptions {
  orientation: RegionOrientation;
}

const ENTRANCE_LAND_PX = 8;

/** Keyed by the card object. The engine mints fresh `GameCard` objects per state
 *  update, so a real change recomputes; the many re-layout passes that reuse the
 *  same objects (resize, blockers, combat staging) hit the cache. */
const stackKeyCache = new WeakMap<GameCard, string>();

/** Derived from the whole engine DTO rather than a hand-picked field list, so
 *  every property the engine reports splits the stack automatically. Only `id`
 *  (always unique) is excluded. */
function stackIdentityKey(c: GameCard): string {
  const cached = stackKeyCache.get(c);
  if (cached !== undefined) return cached;
  const key = JSON.stringify(c, (k, value) => (k === "id" ? undefined : value));
  stackKeyCache.set(c, key);
  return key;
}

export class BoardRegion {
  readonly container: Container;
  private host: RegionHost;
  private orientation: RegionOrientation;
  private mirrored: boolean;
  /** Canvas-aligned for top/bottom; a swapped-dimension rect at the origin for
   *  the rotated left/right sides. */
  private zone!: PlayZoneRect;
  private cardScale: number;

  private backgroundGfx: Graphics;
  private effects = new EffectsLayer();
  private gridSkeletonGfx: Graphics;
  private emptyText: Text;

  private entries = new Map<string, SpriteEntry>();
  private gridInfo: GridLayoutInfo | null = null;
  private gridTargets = new Map<string, Point>();
  private userSlots = new Map<string, { col: number; row: number }>();
  private userPlacedCards = new Set<string>();
  private uiParent = new Map<string, string>();
  private stackCounts = new Map<string, number>();
  private nameGroupChildren = new Set<string>();
  private combatStaging: SceneCombatStaging | null = null;
  private lastState: BattlefieldState | null = null;
  private pendingDropSlot: { col: number; row: number } | null = null;
  private lastDropCell: { col: number; row: number } | null = null;
  private hoveredCardId: string | null = null;
  private dropActive = false;
  private autoSort = false;
  private combatDim = false;

  constructor(
    host: RegionHost,
    parent: Container,
    zone: PlayZoneRect,
    cardScale: number,
    options: BoardRegionOptions,
  ) {
    this.host = host;
    this.cardScale = cardScale;
    this.orientation = options.orientation;
    this.mirrored = options.orientation !== "bottom";

    this.container = new Container();
    this.container.label = "boardRegion";
    this.container.sortableChildren = true;
    parent.addChild(this.container);
    this.applyOrientation(zone);

    this.backgroundGfx = new Graphics();
    this.backgroundGfx.zIndex = -10;
    this.container.addChild(this.backgroundGfx);

    // Above the felt, below the cards.
    this.effects.container.zIndex = 0;
    this.container.addChild(this.effects.container);

    this.gridSkeletonGfx = new Graphics();
    this.gridSkeletonGfx.eventMode = "none";
    this.gridSkeletonGfx.visible = false;
    this.gridSkeletonGfx.zIndex = Z_GRID_SKELETON;
    this.container.addChild(this.gridSkeletonGfx);

    this.emptyText = new Text({ text: "No permanents", style: EMPTY_LABEL_STYLE });
    this.emptyText.anchor.set(0.5);
    this.emptyText.visible = false;
    this.emptyText.zIndex = 0;
    this.container.addChild(this.emptyText);

    this.drawBackground();
  }

  /** Card sprites sit above and stop propagation, so this fires only on empty
   *  felt. */
  enableFeltMarquee(onDown: (e: FederatedPointerEvent) => void): void {
    this.backgroundGfx.eventMode = "static";
    this.backgroundGfx.on("pointerdown", onDown);
  }

  setZone(zone: PlayZoneRect, orientation: RegionOrientation): void {
    this.orientation = orientation;
    this.mirrored = orientation !== "bottom";
    this.applyOrientation(zone);
    this.drawBackground();
    this.layoutEmptyText();
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  /** Top/bottom keep canvas coords (identity transform); left/right rotate 90°
   *  and swap the layout dimensions so the grid runs along the column. */
  private applyOrientation(screenRect: PlayZoneRect): void {
    const c = this.container;
    if (this.orientation === "left") {
      this.zone = { x: 0, y: 0, width: screenRect.height, height: screenRect.width };
      c.rotation = -Math.PI / 2;
      c.position.set(screenRect.x, screenRect.y + screenRect.height);
    } else if (this.orientation === "right") {
      this.zone = { x: 0, y: 0, width: screenRect.height, height: screenRect.width };
      c.rotation = Math.PI / 2;
      c.position.set(screenRect.x + screenRect.width, screenRect.y);
    } else {
      this.zone = screenRect;
      c.rotation = 0;
      c.position.set(0, 0);
    }
  }

  private localToCanvas(x: number, y: number): ScreenPos {
    const c = this.container;
    const cos = Math.cos(c.rotation);
    const sin = Math.sin(c.rotation);
    return { x: c.position.x + x * cos - y * sin, y: c.position.y + x * sin + y * cos };
  }

  private canvasToLocal(x: number, y: number): ScreenPos {
    const c = this.container;
    const cos = Math.cos(c.rotation);
    const sin = Math.sin(c.rotation);
    const dx = x - c.position.x;
    const dy = y - c.position.y;
    return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
  }

  private collectLocalBlockers(): BlockingRect[] {
    return this.host.collectBlockers().map((r) => {
      const p1 = this.canvasToLocal(r.x, r.y);
      const p2 = this.canvasToLocal(r.x + r.width, r.y + r.height);
      return {
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p2.x - p1.x),
        height: Math.abs(p2.y - p1.y),
      };
    });
  }

  setCardScale(scale: number): void {
    if (!Number.isFinite(scale) || scale <= 0 || scale === this.cardScale) return;
    this.cardScale = scale;
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  getCardScale(): number {
    return this.cardScale;
  }

  setDropActive(active: boolean): void {
    if (this.dropActive === active) return;
    this.dropActive = active;
    if (active) {
      this.lastDropCell = null;
    } else {
      this.pendingDropSlot = this.lastDropCell;
      this.lastDropCell = null;
      this.hideGridSkeleton();
    }
    this.drawBackground();
  }

  setAutoSort(value: boolean): void {
    if (this.autoSort === value) return;
    this.autoSort = value;
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  setHoveredCard(cardId: string | null): void {
    this.hoveredCardId = cardId;
  }

  setCombatDim(active: boolean): void {
    this.combatDim = active;
  }

  private isCombatant(card: GameCard): boolean {
    if (card.isAttacking) return true;
    const s = this.combatStaging;
    return !!s && (s.attackerIds.has(card.id) || s.blockerIds.has(card.id));
  }

  setPendingDropSlot(slot: { col: number; row: number } | null): void {
    this.pendingDropSlot = slot;
  }

  getGridInfo(): GridLayoutInfo | null {
    return this.gridInfo;
  }

  getGridTargets(): ReadonlyMap<string, Point> {
    return this.gridTargets;
  }

  getEntries(): ReadonlyMap<string, SpriteEntry> {
    return this.entries;
  }

  getUserSlots(): Map<string, { col: number; row: number }> {
    return this.userSlots;
  }

  getCardPosition(cardId: string): ScreenPos | null {
    const entry = this.entries.get(cardId);
    return entry ? this.localToCanvas(entry.targetX, entry.targetY) : null;
  }

  getLastState(): BattlefieldState | null {
    return this.lastState;
  }

  hasLastState(): boolean {
    return this.lastState !== null;
  }

  applyBaseRing(sprite: CardSprite): void {
    if (this.lastState) this.applyBattlefieldRing(sprite, this.lastState);
  }

  setCombatStaging(staging: SceneCombatStaging | null): void {
    if (staging === null && this.combatStaging === null) return;
    this.combatStaging = staging;
    if (this.lastState) this.updateBattlefield(this.lastState);
  }

  animate(): void {
    let exited: string[] | null = null;
    const now = performance.now();
    for (const [id, entry] of this.entries) {
      const s = entry.sprite;
      if (entry.exiting) {
        s.alpha = lerp(s.alpha, 0, EXIT_FADE_LERP, 0.02);
        s.scale.set(s.scale.x * EXIT_SHRINK);
        if (s.alpha <= 0.05) (exited ??= []).push(id);
        continue;
      }
      s.tickEffects(now);
      s.x = lerp(s.x, entry.targetX, BATTLEFIELD_LERP, SNAP_PX);
      s.y = lerp(s.y, entry.targetY, BATTLEFIELD_LERP, SNAP_PX);
      if (entry.pendingEntrance) {
        const dx = s.x - entry.targetX;
        const dy = s.y - entry.targetY;
        if (dx * dx + dy * dy < ENTRANCE_LAND_PX * ENTRANCE_LAND_PX) {
          entry.pendingEntrance = false;
          this.playEntranceFx(entry, s.card);
        }
      }
      if (entry.shakeFrames > 0) {
        const amp = DAMAGE_SHAKE_AMP_PX * (entry.shakeFrames / DAMAGE_SHAKE_FRAMES);
        s.x += (Math.random() - 0.5) * 2 * amp;
        s.y += (Math.random() - 0.5) * 2 * amp;
        entry.shakeFrames -= 1;
      }
      s.rotation = lerp(s.rotation, entry.targetRotation, ROTATION_LERP, SNAP_ROT);
      s.zIndex = entry.targetZIndex;

      // Alpha is owned here (not in updateCard), so a state update mid-combat
      // doesn't snap a dimmed/phased card back to 1 and re-fade it (flicker).
      // Combat dim darkens via tint rather than alpha so overlapping stacked
      // cards don't show through one another; phased-out keeps a real fade.
      const dimmed =
        this.combatDim &&
        this.hoveredCardId !== s.card.id &&
        !this.isCombatant(s.card) &&
        !this.lastState?.selectableCardIds?.includes(s.card.id);
      const curBright = (s.tint & 0xff) / 255;
      const nextBright = lerp(
        curBright,
        dimmed ? COMBAT_DIM_TINT_LEVEL : 1,
        OVERLAY_FADE_LERP,
        0.01,
      );
      const ch = Math.round(nextBright * 255);
      s.tint = (ch << 16) | (ch << 8) | ch;
      s.alpha = lerp(
        s.alpha,
        s.card.phasedOut ? COMBAT_DIM_ALPHA : 1,
        OVERLAY_FADE_LERP,
        SNAP_ALPHA,
      );

      if (entry.etbGlowAlpha > 0) {
        entry.etbGlowAlpha = lerp(entry.etbGlowAlpha, 0, OVERLAY_FADE_LERP, SNAP_ALPHA);
      }
      s.setEntryGlowAlpha(entry.etbGlowAlpha);

      const isHovered = this.hoveredCardId === s.card.id;
      const targetScale = this.cardScale * (isHovered ? HOVER_SCALE : 1);
      entry.scaleBase = lerp(entry.scaleBase, targetScale, HOVER_SCALE_LERP, SNAP_SCALE);
      const fx = s.fxScale;
      s.scale.set(entry.scaleBase * fx.x, entry.scaleBase * fx.y);

      if (entry.overlay?.visible) {
        entry.overlay.x = s.x;
        entry.overlay.y = s.y;
        entry.overlay.zIndex = entry.targetZIndex + Z_OVERLAY_OFFSET;
        entry.overlay.alpha = lerp(
          entry.overlay.alpha,
          isHovered ? 1 : 0,
          OVERLAY_FADE_LERP,
          SNAP_ALPHA,
        );
      }
    }
    if (exited) for (const id of exited) this.destroyEntry(id);
    this.effects.tick();
  }

  updateBattlefield(state: BattlefieldState): void {
    if (this.host.isDestroyed() || !state || !Array.isArray(state.cards)) return;
    const prevCards = new Map<string, GameCard>();
    for (const c of this.lastState?.cards ?? []) prevCards.set(c.id, c);
    const isFirstState = this.lastState === null;
    this.lastState = state;
    const cardMap = new Map<string, GameCard>(state.cards.map((c) => [c.id, c]));
    const currentIds = new Set(state.cards.map((c) => c.id));

    for (const childId of this.nameGroupChildren) {
      this.uiParent.delete(childId);
    }
    this.nameGroupChildren.clear();

    const effectiveParent = new Map<string, string>();
    for (const c of state.cards) {
      if (c.attachedTo && cardMap.has(c.attachedTo)) {
        effectiveParent.set(c.id, c.attachedTo);
      }
    }
    for (const [childId, parentId] of [...this.uiParent]) {
      if (!currentIds.has(childId) || !currentIds.has(parentId)) {
        this.uiParent.delete(childId);
        continue;
      }
      if (childId === parentId) {
        this.uiParent.delete(childId);
        continue;
      }
      if (!effectiveParent.has(childId)) {
        effectiveParent.set(childId, parentId);
      }
    }
    const tentativeTopLevelForGrouping = state.cards.filter((c) => !effectiveParent.has(c.id));
    this.applyNameGrouping(tentativeTopLevelForGrouping);
    for (const [childId, parentId] of [...this.uiParent]) {
      if (!currentIds.has(childId) || !currentIds.has(parentId)) continue;
      if (childId === parentId) continue;
      if (!effectiveParent.has(childId)) {
        effectiveParent.set(childId, parentId);
      }
    }
    const tentativeTopLevel = state.cards.filter((c) => !effectiveParent.has(c.id));
    this.applyOverflowStacking(tentativeTopLevel);
    for (const [childId, parentId] of [...this.uiParent]) {
      if (!currentIds.has(childId) || !currentIds.has(parentId)) continue;
      if (childId === parentId) continue;
      if (!effectiveParent.has(childId)) {
        effectiveParent.set(childId, parentId);
      }
    }

    const effectiveChildren = new Map<string, string[]>();
    for (const [childId, parentId] of effectiveParent) {
      const list = effectiveChildren.get(parentId) ?? [];
      list.push(childId);
      effectiveChildren.set(parentId, list);
    }
    const topLevelCards = state.cards.filter((c) => !effectiveParent.has(c.id));

    this.pruneRemovedBattlefieldEntries(currentIds);
    for (const id of [...this.userSlots.keys()]) {
      if (!currentIds.has(id) || effectiveParent.has(id)) {
        this.userSlots.delete(id);
      }
    }
    const positions = this.computeBattlefieldGrid(topLevelCards);
    this.gridTargets = positions;

    for (const card of topLevelCards) {
      const center = positions.get(card.id) ?? { x: this.zoneCenterX(), y: this.zoneCenterY() };
      const childIds = effectiveChildren.get(card.id) ?? [];
      const attachments = childIds
        .map((id) => cardMap.get(id))
        .filter((c): c is GameCard => c !== undefined);
      const visibleSteps = Math.min(attachments.length, STACK_MAX_SLIDE_CARDS - 1);
      const totalOffset = visibleSteps * ATTACH_OFFSET_Y;
      const topLeftY = center.y - (CARD_H * this.cardScale) / 2;

      for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i]!;
        const stepsAbove = Math.min(attachments.length - i, visibleSteps);
        this.placeBattlefieldCard(
          att,
          center.x,
          topLeftY + totalOffset - stepsAbove * ATTACH_OFFSET_Y + (CARD_H * this.cardScale) / 2,
          i + 1,
          state,
        );
      }

      this.placeBattlefieldCard(
        card,
        center.x,
        topLeftY + totalOffset + (CARD_H * this.cardScale) / 2,
        attachments.length + 1,
        state,
      );
    }

    this.applyCombatStaging();
    this.applyAttackLunge(state);
    if (!isFirstState) {
      const lethal = hexToNum(this.host.getTheme().gameTheme.pt.lethal);
      const cardHalfH = (CARD_H * this.cardScale) / 2;
      const now = performance.now();
      for (const card of state.cards) {
        const entry = this.entries.get(card.id);
        if (!entry) continue;
        const prev = prevCards.get(card.id);
        if (!prev) {
          entry.etbGlowAlpha = 1;
          entry.pendingEntrance = true;
          continue;
        }
        const fx = animationsEnabled();
        if (fx && (card.power !== prev.power || card.toughness !== prev.toughness)) {
          entry.sprite.playStatPop(now);
        }
        const delta = (card.damage ?? 0) - (prev.damage ?? 0);
        if (delta > 0) {
          // The damage number always shows (it's info); only the flash + shake
          // are suppressed by the animation toggle.
          if (fx) {
            entry.sprite.playDamageHit(now);
            entry.shakeFrames = DAMAGE_SHAKE_FRAMES;
          }
          const c = this.localToCanvas(entry.targetX, entry.targetY);
          this.host.spawnFloatingText(c.x, c.y - cardHalfH, `-${delta}`, lethal);
        }
      }
    }
    this.emptyText.visible = state.cards.length === 0;
  }

  private applyAttackLunge(state: BattlefieldState): void {
    if (this.orientation === "left" || this.orientation === "right") return;
    const staged = this.combatStaging?.attackerIds;
    const frontY = this.frontEdgeY();
    for (const card of state.cards) {
      if (!card.isAttacking || staged?.has(card.id)) continue;
      const entry = this.entries.get(card.id);
      if (!entry) continue;
      entry.targetY = frontY;
      entry.targetZIndex = Math.max(entry.targetZIndex, Z_COMBAT_STAGED - 1);
    }
  }

  private applyCombatStaging(): void {
    const staging = this.combatStaging;
    if (!staging) return;
    // The front-edge / lane math is vertical, so the rotated side regions keep
    // their resting layout during combat.
    if (this.orientation === "left" || this.orientation === "right") return;
    const frontY = this.frontEdgeY();
    const fanStep = CARD_W * this.cardScale * COMBAT_STAGE_FAN_FRAC;

    for (const id of staging.attackerIds) {
      const entry = this.entries.get(id);
      if (!entry) continue;
      entry.targetY = frontY;
      entry.targetZIndex = Z_COMBAT_STAGED;
    }

    const onAttacker = CARD_H * this.cardScale * COMBAT_BLOCKER_OVERLAP_FRAC;
    for (const b of staging.blockers) {
      const entry = this.entries.get(b.id);
      if (!entry) continue;
      const offset = (b.indexInLane - (b.laneCount - 1) / 2) * fanStep;
      entry.targetX = this.host.screenXToLocalX(b.laneScreenX) + offset;
      entry.targetY = b.attackerY + (this.mirrored ? -onAttacker : onAttacker);
      entry.targetZIndex = Z_COMBAT_STAGED + 1;
    }
  }

  private frontEdgeY(): number {
    const gap = STRIP_BAND_PX / 2 + COMBAT_STAGE_PADDING_PX + (CARD_H * this.cardScale) / 2;
    if (this.mirrored) {
      const dividerY = this.zone.y + this.zone.height + STRIP_BAND_PX / 2;
      return dividerY - gap;
    }
    const dividerY = this.zone.y - STRIP_BAND_PX / 2;
    return dividerY + gap - COMBAT_STAGE_SELF_EXTRA_PX;
  }

  private applyNameGrouping(topLevel: GameCard[]): void {
    this.stackCounts.clear();
    if (topLevel.length < 2) return;

    const isStackable = (c: GameCard): boolean =>
      !c.isAttacking &&
      !this.combatStaging?.blockerIds.has(c.id) &&
      !c.attachedTo &&
      !c.isBestowed &&
      !c.isFaceDown &&
      !c.isTransformed &&
      (!c.attachmentIds || c.attachmentIds.length === 0) &&
      !this.userPlacedCards.has(c.id);

    const byIdentity = new Map<string, GameCard[]>();
    for (const c of topLevel) {
      if (!isStackable(c)) continue;
      const key = stackIdentityKey(c);
      const list = byIdentity.get(key);
      if (list) list.push(c);
      else byIdentity.set(key, [c]);
    }

    for (const group of byIdentity.values()) {
      if (group.length < 2) continue;
      const parent = group[0]!;
      for (let i = 1; i < group.length; i++) {
        const child = group[i]!;
        this.uiParent.set(child.id, parent.id);
        this.nameGroupChildren.add(child.id);
      }
      this.stackCounts.set(parent.id, group.length);
    }
  }

  private applyOverflowStacking(topLevelCandidates: GameCard[]): void {
    if (topLevelCandidates.length === 0) return;
    const zone = this.usableZone();
    const grid = computeGridLayout(zone, 0, this.collectLocalBlockers(), this.cardScale);
    let freeCellCount = 0;
    for (const cell of grid.cells) {
      if (!cell.blocked) freeCellCount++;
    }
    if (topLevelCandidates.length <= freeCellCount) return;

    const prioritized = topLevelCandidates.map((card, i) => ({ card, i }));
    prioritized.sort((a, b) => {
      const aHas = this.userSlots.has(a.card.id) ? 1 : 0;
      const bHas = this.userSlots.has(b.card.id) ? 1 : 0;
      if (aHas !== bHas) return aHas - bHas;
      return a.i - b.i;
    });
    const overflowCount = topLevelCandidates.length - freeCellCount;
    const overflow = prioritized.slice(-overflowCount).map((p) => p.card);
    const overflowIds = new Set(overflow.map((c) => c.id));
    const keepers = topLevelCandidates.filter((c) => !overflowIds.has(c.id));
    if (keepers.length === 0) return;

    const centerX = zone.x + zone.width / 2;
    const topAnchorY = zone.y + grid.cellH / 2;
    const bottomAnchorY = zone.y + zone.height - grid.cellH / 2;
    const nonLandAnchorY = this.mirrored ? bottomAnchorY : topAnchorY;
    const landAnchorY = this.mirrored ? topAnchorY : bottomAnchorY;

    const keeperPos = (id: string, fallbackY: number): Point => {
      const slot = this.userSlots.get(id);
      if (slot) {
        const cell = cellAt(grid, slot.col, slot.row);
        if (cell) return { x: cell.cx, y: cell.cy };
      }
      return { x: centerX, y: fallbackY };
    };

    for (const oc of overflow) {
      const isLand = oc.types.includes("Land");
      const anchorY = isLand ? landAnchorY : nonLandAnchorY;
      let bestId: string | null = null;
      let bestDist = Infinity;
      for (const k of keepers) {
        if (k.id === oc.id) continue;
        const kp = keeperPos(k.id, anchorY);
        const d = (kp.x - centerX) ** 2 + (kp.y - anchorY) ** 2;
        if (d < bestDist) {
          bestDist = d;
          bestId = k.id;
        }
      }
      if (bestId) {
        this.uiParent.set(oc.id, bestId);
        this.userSlots.delete(oc.id);
      }
    }
  }

  private computeBattlefieldGrid(cards: GameCard[]): Map<string, Point> {
    const positions = new Map<string, Point>();
    const zone = this.usableZone();
    const grid = computeGridLayout(zone, 0, this.collectLocalBlockers(), this.cardScale);
    this.gridInfo = grid;

    const occupied = new Set<string>();
    const unplaced: GameCard[] = [];

    for (const c of cards) {
      const slot = this.autoSort ? undefined : this.userSlots.get(c.id);
      if (!slot) {
        unplaced.push(c);
        continue;
      }
      const cell = cellAt(grid, slot.col, slot.row);
      if (!cell) {
        this.userSlots.delete(c.id);
        unplaced.push(c);
        continue;
      }
      if (cell.blocked || occupied.has(cellKey(cell.col, cell.row))) {
        unplaced.push(c);
        continue;
      }
      positions.set(c.id, { x: cell.cx, y: cell.cy });
      occupied.add(cellKey(cell.col, cell.row));
    }

    if (this.pendingDropSlot && unplaced.length > 0) {
      const dropCell = cellAt(grid, this.pendingDropSlot.col, this.pendingDropSlot.row);
      if (dropCell && !dropCell.blocked && !occupied.has(cellKey(dropCell.col, dropCell.row))) {
        const dropCandidate = unplaced[0]!;
        this.userSlots.set(dropCandidate.id, this.pendingDropSlot);
        this.userPlacedCards.add(dropCandidate.id);
        positions.set(dropCandidate.id, { x: dropCell.cx, y: dropCell.cy });
        occupied.add(cellKey(dropCell.col, dropCell.row));
        unplaced.shift();
      }
      this.pendingDropSlot = null;
    }

    const centerX = zone.x + zone.width / 2;

    let lastUsableRow = grid.rows - 1;
    while (lastUsableRow > 0) {
      const midCell = cellAt(grid, Math.floor(grid.cols / 2), lastUsableRow);
      if (midCell && !midCell.blocked) break;
      lastUsableRow--;
    }

    const usableRows = lastUsableRow + 1;
    let creatureRows: number[];
    let otherRows: number[];
    let landRows: number[];
    if (usableRows >= 3) {
      creatureRows = [0];
      otherRows = [];
      for (let r = 1; r < lastUsableRow; r++) otherRows.push(r);
      if (otherRows.length === 0) otherRows.push(1);
      landRows = [lastUsableRow];
    } else if (usableRows === 2) {
      creatureRows = [0];
      otherRows = [0, 1];
      landRows = [lastUsableRow];
    } else {
      creatureRows = [0];
      otherRows = [0];
      landRows = [0];
    }

    if (this.mirrored) {
      const flip = (rows: number[]) => rows.map((r) => lastUsableRow - r);
      creatureRows = flip(creatureRows);
      otherRows = flip(otherRows);
      landRows = flip(landRows);
    }

    type CardCategory = "creature" | "land" | "other";
    const classify = (c: GameCard): CardCategory => {
      if (c.types.includes("Creature")) return "creature";
      if (c.types.includes("Land")) return "land";
      return "other";
    };

    const categoryConfig: Record<CardCategory, { rows: number[]; anchorTop: boolean }> = {
      creature: { rows: creatureRows, anchorTop: !this.mirrored },
      other: { rows: otherRows, anchorTop: !this.mirrored },
      land: { rows: landRows, anchorTop: this.mirrored },
    };

    const catOrder: CardCategory[] = ["creature", "other", "land"];
    const sortedUnplaced = [...unplaced].sort(
      (a, b) => catOrder.indexOf(classify(a)) - catOrder.indexOf(classify(b)),
    );

    for (const c of sortedUnplaced) {
      const cat = classify(c);
      const cfg = categoryConfig[cat];
      const rowSet = new Set(cfg.rows);
      const anchorY = cfg.anchorTop
        ? zone.y + grid.cellH / 2
        : zone.y + zone.height - grid.cellH / 2;
      const sorted = cellsByDistance(grid, centerX, anchorY);
      const max = cat === "land" ? MAX_LAND_SLOTS : MAX_GRID_SLOTS;

      let picked: GridCell | null = null;
      for (let i = 0; i < sorted.length && i < max; i++) {
        const cell = sorted[i]!;
        if (cell.blocked) continue;
        if (occupied.has(cellKey(cell.col, cell.row))) continue;
        if (!rowSet.has(cell.row)) continue;
        picked = cell;
        break;
      }

      if (!picked) {
        for (let i = 0; i < sorted.length && i < max; i++) {
          const cell = sorted[i]!;
          if (cell.blocked) continue;
          if (occupied.has(cellKey(cell.col, cell.row))) continue;
          picked = cell;
          break;
        }
      }

      if (picked) {
        positions.set(c.id, { x: picked.cx, y: picked.cy });
        occupied.add(cellKey(picked.col, picked.row));
        this.userSlots.set(c.id, { col: picked.col, row: picked.row });
      } else {
        positions.set(c.id, { x: centerX, y: anchorY });
      }
    }

    return positions;
  }

  getPlacementGhostCenter(): ScreenPos {
    const slot = this.findFirstFreeBattlefieldSlot();
    return {
      x: slot.x + (CARD_W * this.cardScale) / 2,
      y: slot.y + (CARD_H * this.cardScale) / 2,
    };
  }

  private findFirstFreeBattlefieldSlot(): Point {
    const zone = this.usableZone();
    const grid =
      this.gridInfo ?? computeGridLayout(zone, 0, this.collectLocalBlockers(), this.cardScale);
    const occupied = new Set<string>();
    for (const pos of this.gridTargets.values()) {
      const cell = cellFromPoint(grid, pos.x, pos.y);
      if (cell) occupied.add(cellKey(cell.col, cell.row));
    }

    if (this.pendingDropSlot) {
      const dropCell = cellAt(grid, this.pendingDropSlot.col, this.pendingDropSlot.row);
      if (dropCell && !dropCell.blocked && !occupied.has(cellKey(dropCell.col, dropCell.row))) {
        return { x: dropCell.x, y: dropCell.y };
      }
    }

    const anchorX = zone.x + zone.width / 2;
    const anchorY = this.mirrored ? zone.y + zone.height - grid.cellH / 2 : zone.y + grid.cellH / 2;
    const sorted = cellsByDistance(grid, anchorX, anchorY);
    for (const cell of sorted) {
      if (cell.blocked) continue;
      if (occupied.has(cellKey(cell.col, cell.row))) continue;
      return { x: cell.x, y: cell.y };
    }
    return { x: anchorX - grid.cardW / 2, y: anchorY - grid.cardH / 2 };
  }

  private pruneRemovedBattlefieldEntries(currentIds: Set<string>): void {
    for (const [id, entry] of this.entries) {
      if (currentIds.has(id) || entry.exiting) continue;
      entry.exiting = true;
      if (entry.overlay) entry.overlay.visible = false;
      this.userPlacedCards.delete(id);
    }
  }

  private destroyEntry(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.container.removeChild(entry.sprite);
    if (entry.overlay) this.container.removeChild(entry.overlay);
    safeDestroy(entry.sprite);
    if (entry.overlay) safeDestroy(entry.overlay);
    this.entries.delete(id);
  }

  private placeBattlefieldCard(
    card: GameCard,
    centerX: number,
    centerY: number,
    zIndex: number,
    state: BattlefieldState,
  ): void {
    this.ensureBattlefieldEntry(card);
    const entry = this.entries.get(card.id)!;
    if (entry.exiting) {
      entry.exiting = false;
      entry.sprite.alpha = 1;
    }
    entry.targetX = centerX;
    entry.targetY = centerY;
    entry.targetZIndex = zIndex;
    const overriddenCard =
      card.id === DEBUG_KEYWORD_CARD_ID
        ? applyCardOverrides(card, useGameDevStore.getState().cardOverrides)
        : card;
    entry.sprite.updateCardContent(overriddenCard);
    entry.sprite.setStackCount(this.stackCounts.get(card.id) ?? 1);
    const orderIdx = state.orderedCardIds?.indexOf(card.id) ?? -1;
    entry.sprite.setOrderBadge(orderIdx >= 0 ? orderIdx + 1 : null);
    entry.targetRotation = overriddenCard.tapped ? (this.mirrored ? -Math.PI / 2 : Math.PI / 2) : 0;
    this.applyBattlefieldRing(entry.sprite, state);
    this.host.rebuildOverlay(entry, state);
  }

  private ensureBattlefieldEntry(card: GameCard): void {
    if (this.entries.has(card.id)) return;
    const sprite = new CardSprite(card);
    this.host.wireSprite(sprite);
    this.container.addChild(sprite);

    const seed = this.host.getEntrySeed(card.id);
    const local = this.canvasToLocal(seed.x, seed.y);
    sprite.x = local.x;
    sprite.y = local.y;
    sprite.scale.set(seed.scaleX, seed.scaleY);

    this.entries.set(card.id, {
      sprite,
      targetX: sprite.x,
      targetY: sprite.y,
      targetZIndex: 1,
      targetRotation: sprite.rotation,
      etbGlowAlpha: 0,
      scaleBase: sprite.scale.x,
      shakeFrames: 0,
      pendingEntrance: false,
      overlay: null,
    });
  }

  private applyBattlefieldRing(sprite: CardSprite, state: BattlefieldState): void {
    const theme = this.host.getTheme();
    const card = sprite.card;
    sprite.setDoomed(card.wouldDieInCombat ?? false);
    if (this.host.isSelected(card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.cardRing));
      return;
    }
    // Attacking and summoning-sickness are shown by the card's own edge glow
    // (CardSprite.updateEdgeGlow), not by a ring.
    if (card.wouldDieInCombat) {
      sprite.setRing(hexToNum(theme.gameTheme.pt.lethal));
    } else if (state.pendingCardIds?.includes(card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.promptAction.passAction));
    } else if (state.tappableLandIds?.includes(card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.cardRing));
    } else if (state.untappableLandIds?.includes(card.id)) {
      sprite.setRing(hexToNum(theme.gameTheme.promptAction.cancel));
    } else if (state.selectableCardIds?.includes(card.id)) {
      sprite.setRing(
        state.hostileTargeting
          ? hexToNum(theme.gameTheme.arrow.hostileTarget)
          : hexToNum(theme.gameTheme.cardRing),
      );
    } else {
      sprite.setRing(null);
    }
  }

  /** The zone with its bottom trimmed so it clears the hand fan (local player
   *  only). Drives the felt, the empty label, and the card grid, so there are
   *  never grid cells at the hand's row level. */
  private usableZone(): PlayZoneRect {
    const zone = this.zone;
    const reserve = this.host.getHandReserveBottom();
    if (reserve <= 0) return zone;
    return { ...zone, height: Math.max(0, zone.height - reserve) };
  }

  redrawBackground(): void {
    this.drawBackground();
    this.layoutEmptyText();
  }

  private drawBackground(): void {
    const felt = this.usableZone();
    this.backgroundGfx.clear();
    this.backgroundGfx.roundRect(felt.x, felt.y, felt.width, felt.height, TABLE_RADIUS);
    this.backgroundGfx.fill({
      color: hexToNum(this.host.getTheme().gameTheme.canvas.background),
      alpha: this.dropActive ? BG_ALPHA_DROP : BG_ALPHA_IDLE,
    });
  }

  private layoutEmptyText(): void {
    const felt = this.usableZone();
    this.emptyText.scale.set(1);
    const maxWidth = felt.width - 16;
    if (maxWidth > 0 && this.emptyText.width > maxWidth) {
      this.emptyText.scale.set(maxWidth / this.emptyText.width);
    }
    this.emptyText.x = felt.x + felt.width / 2;
    this.emptyText.y = felt.y + felt.height / 2;
  }

  private zoneCenterX(): number {
    return this.zone.x + this.zone.width / 2;
  }

  private zoneCenterY(): number {
    return this.zone.y + this.zone.height / 2;
  }

  redrawTheme(): void {
    this.drawBackground();
  }

  restyleCards(): void {
    for (const entry of this.entries.values()) entry.sprite.restyle();
  }

  previewEtb(): void {
    for (const entry of this.entries.values()) {
      entry.etbGlowAlpha = 1;
      this.playEntranceFx(entry, entry.sprite.card);
    }
  }

  private playEntranceFx(entry: SpriteEntry, card: GameCard): void {
    if (!animationsEnabled()) return;
    if (!card.types?.some((t) => t.toLowerCase() === "creature")) return;
    const footX = entry.targetX;
    const footY = entry.targetY + (CARD_H * this.cardScale) / 2;
    playStomp({
      fxScale: entry.sprite.fxScale,
      onImpact: () => this.effects.stompGround(footX, footY),
    });
  }

  redrawHoverDebug(): void {
    for (const entry of this.entries.values()) entry.sprite.redrawHoverDebug();
  }

  getEffectiveChildren(parentId: string): string[] {
    const parent = this.lastState?.cards.find((c) => c.id === parentId);
    const result: string[] = [];
    const seen = new Set<string>();
    if (parent?.attachmentIds) {
      for (const id of parent.attachmentIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        result.push(id);
      }
    }
    for (const [childId, pId] of this.uiParent) {
      if (pId !== parentId) continue;
      if (seen.has(childId)) continue;
      seen.add(childId);
      result.push(childId);
    }
    return result;
  }

  followAttachmentsDuringDrag(parentId: string, parentCenter: Point): void {
    const children = this.getEffectiveChildren(parentId);
    if (children.length === 0) return;
    const visibleSteps = Math.min(children.length, STACK_MAX_SLIDE_CARDS - 1);
    const parentEntry = this.entries.get(parentId);
    if (parentEntry) {
      parentEntry.targetY = parentCenter.y;
      parentEntry.sprite.y = parentCenter.y;
      if (parentEntry.overlay?.visible) parentEntry.overlay.y = parentCenter.y;
    }
    for (let i = 0; i < children.length; i++) {
      const childId = children[i]!;
      const child = this.entries.get(childId);
      if (!child) continue;
      const stepsAbove = Math.min(children.length - i, visibleSteps);
      const cy = parentCenter.y - stepsAbove * ATTACH_OFFSET_Y;
      child.targetX = parentCenter.x;
      child.targetY = cy;
      child.sprite.x = parentCenter.x;
      child.sprite.y = cy;
      if (child.overlay?.visible) {
        child.overlay.x = parentCenter.x;
        child.overlay.y = cy;
      }
    }
  }

  findStackTargetAt(cell: GridCell, exclude: Set<string>): string | null {
    if (!this.gridInfo) return null;
    for (const [id, pos] of this.gridTargets) {
      if (exclude.has(id)) continue;
      const c = cellFromPoint(this.gridInfo, pos.x, pos.y);
      if (c && c.col === cell.col && c.row === cell.row) return id;
    }
    return null;
  }

  commitCellDrop(draggedIds: string[], target: GridCell, primaryId: string | null): void {
    if (!this.gridInfo || draggedIds.length === 0) return;
    const grid = this.gridInfo;

    const sourceCell = new Map<string, GridCell>();
    for (const id of draggedIds) {
      const pos = this.gridTargets.get(id);
      if (!pos) continue;
      const cell = cellFromPoint(grid, pos.x, pos.y);
      if (cell) sourceCell.set(id, cell);
    }

    const primary = primaryId && sourceCell.has(primaryId) ? primaryId : draggedIds[0]!;
    const primarySrc = sourceCell.get(primary);
    const dCol = primarySrc ? target.col - primarySrc.col : 0;
    const dRow = primarySrc ? target.row - primarySrc.row : 0;

    const draggedSet = new Set(draggedIds);
    const reserved = new Set<string>();
    for (const [id, pos] of this.gridTargets) {
      if (draggedSet.has(id)) continue;
      const c = cellFromPoint(grid, pos.x, pos.y);
      if (c) reserved.add(cellKey(c.col, c.row));
    }

    for (const id of draggedIds) {
      this.uiParent.delete(id);
      const src = sourceCell.get(id);
      const wantCol = (src?.col ?? target.col) + dCol;
      const wantRow = (src?.row ?? target.row) + dRow;

      let placed: GridCell | null = null;
      const wantCell = cellAt(grid, wantCol, wantRow);
      if (wantCell && !wantCell.blocked && !reserved.has(cellKey(wantCell.col, wantCell.row))) {
        placed = wantCell;
      } else {
        const anchorX = wantCell?.cx ?? target.cx + dCol * grid.cellW;
        const anchorY = wantCell?.cy ?? target.cy + dRow * grid.cellH;
        for (const cell of cellsByDistance(grid, anchorX, anchorY)) {
          if (cell.blocked) continue;
          if (reserved.has(cellKey(cell.col, cell.row))) continue;
          placed = cell;
          break;
        }
      }

      if (placed) {
        reserved.add(cellKey(placed.col, placed.row));
        this.userSlots.set(id, { col: placed.col, row: placed.row });
        this.userPlacedCards.add(id);
      }
    }
  }

  commitStackDrop(draggedIds: string[], targetId: string): void {
    for (const id of draggedIds) {
      if (id === targetId) continue;
      if (this.uiParent.get(targetId) === id) this.uiParent.delete(targetId);
      this.uiParent.set(id, targetId);
      this.userSlots.delete(id);
      this.userPlacedCards.delete(id);
    }
  }

  snapshotCurrentPositions(): Map<string, Point> {
    const positions = new Map<string, Point>();
    for (const [id, entry] of this.entries) {
      positions.set(id, { x: entry.sprite.x, y: entry.sprite.y });
    }
    return positions;
  }

  hideGridSkeleton(): void {
    this.gridSkeletonGfx.visible = false;
    this.gridSkeletonGfx.clear();
  }

  drawGridSkeleton(
    draggingIds: Set<string>,
    hoveredCell: GridCell | null,
    stackTargetId: string | null,
  ): void {
    const gfx = this.gridSkeletonGfx;
    gfx.clear();
    if (!this.gridInfo || draggingIds.size === 0) {
      gfx.visible = false;
      return;
    }
    const grid = this.gridInfo;
    const color = hexToNum(this.host.getTheme().gameTheme.activeAction.active);
    const occupied = new Map<string, string>();
    for (const [id, pos] of this.gridTargets) {
      if (draggingIds.has(id)) continue;
      const c = cellFromPoint(grid, pos.x, pos.y);
      if (c) occupied.set(cellKey(c.col, c.row), id);
    }
    const hoveredKey = hoveredCell ? cellKey(hoveredCell.col, hoveredCell.row) : null;
    let stackKey: string | null = null;
    if (stackTargetId !== null) {
      const pos = this.gridTargets.get(stackTargetId);
      const c = pos ? cellFromPoint(grid, pos.x, pos.y) : null;
      stackKey = c ? cellKey(c.col, c.row) : null;
    }

    for (const cell of grid.cells) {
      if (cell.blocked) continue;
      const key = cellKey(cell.col, cell.row);
      const isStack = key === stackKey;
      const isHover = key === hoveredKey && !isStack;
      const isOccupied = occupied.has(key) && !isStack;
      const strokeAlpha = isStack
        ? GRID_SKELETON_STACK_ALPHA
        : isHover
          ? GRID_SKELETON_HOVER_ALPHA
          : GRID_SKELETON_STROKE_ALPHA;
      const fillAlpha = isStack
        ? GRID_SKELETON_STACK_FILL_ALPHA
        : isHover
          ? GRID_SKELETON_FILL_ALPHA * 4
          : isOccupied
            ? 0
            : GRID_SKELETON_FILL_ALPHA;
      gfx.roundRect(cell.x, cell.y, grid.cardW, grid.cardH, CARD_RADIUS);
      if (fillAlpha > 0) gfx.fill({ color, alpha: fillAlpha });
      gfx.stroke({ color, width: isStack || isHover ? 2 : 1, alpha: strokeAlpha });
    }
    gfx.visible = true;
  }

  drawDropGrid(localX: number, localY: number): void {
    const grid = computeGridLayout(
      this.usableZone(),
      0,
      this.collectLocalBlockers(),
      this.cardScale,
    );
    const color = hexToNum(this.host.getTheme().gameTheme.activeAction.active);
    const gfx = this.gridSkeletonGfx;
    gfx.clear();

    const hoveredCell = cellFromPoint(grid, localX, localY);
    this.lastDropCell =
      hoveredCell && !hoveredCell.blocked ? { col: hoveredCell.col, row: hoveredCell.row } : null;
    const hoveredKey =
      hoveredCell && !hoveredCell.blocked ? cellKey(hoveredCell.col, hoveredCell.row) : null;

    for (const cell of grid.cells) {
      if (cell.blocked) continue;
      const key = cellKey(cell.col, cell.row);
      const isHover = key === hoveredKey;
      gfx.roundRect(cell.x, cell.y, grid.cardW, grid.cardH, CARD_RADIUS);
      gfx.fill({ color, alpha: isHover ? GRID_SKELETON_FILL_ALPHA * 5 : GRID_SKELETON_FILL_ALPHA });
      gfx.stroke({
        color,
        width: isHover ? 2 : 1,
        alpha: isHover ? GRID_SKELETON_HOVER_ALPHA : GRID_SKELETON_STROKE_ALPHA,
      });
    }
    gfx.visible = true;
  }

  drawDropField(): void {
    // Instants/sorceries go to the stack, not a cell — no drop slot to capture.
    this.lastDropCell = null;
    const zone = this.usableZone();
    const color = hexToNum(this.host.getTheme().gameTheme.arrow.friendlyTarget);
    const pad = GAP * 2;
    const gfx = this.gridSkeletonGfx;
    gfx.clear();
    gfx.roundRect(
      zone.x + pad,
      zone.y + pad,
      zone.width - pad * 2,
      zone.height - pad * 2,
      TABLE_RADIUS,
    );
    gfx.fill({ color, alpha: GRID_SKELETON_FILL_ALPHA * 4 });
    gfx.stroke({ color, width: 3, alpha: GRID_SKELETON_HOVER_ALPHA });
    gfx.visible = true;
  }

  destroy(): void {
    this.effects.destroy();
    this.entries.clear();
  }
}
