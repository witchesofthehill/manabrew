import { Container, Graphics, type FederatedPointerEvent } from "pixi.js";
import type { CardDto } from "@/protocol/game";
import { CardSprite } from "../CardSprite";
import { getTheme } from "@/hooks/useTheme";
import type { HandState, ScreenBounds, ScreenPos } from "../types";
import { hexToNum } from "../colorUtils";
import { computeBaseLayout, computeHandLayout, HAND_FAN_PARAMS } from "../HandLayout";
import { HAND_CARD_BASE } from "@/components/game/game.styles";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import {
  CAST_DRAG_CARD_DROP_PX,
  CAST_DRAG_HAND_SINK_PX,
  CAST_DRAG_SCALE,
  GAP,
  HAND_HOVER_HOLD_MS,
  HAND_LERP,
  PLAYABLE_HIGHLIGHT_ALPHA,
  PLAYABLE_RING_ALPHA,
  SNAP_HAND_SCALE,
  SNAP_PX,
  SNAP_ROT,
  HAND_MAX_ZONE_HEIGHT_FRACTION,
  Z_HAND_CONTAINER,
  Z_HAND_HOVERED,
} from "../constants";
import { lerp, safeDestroy } from "./pixiHelpers";
import type { BlockingRect, HandHitZone, HandHost, HandTarget } from "./types";

const HAND_SELECTION_DROP_PX = 30;

export class HandController {
  private host: HandHost;
  readonly container: Container;
  private sprites = new Map<string, CardSprite>();
  private targets = new Map<string, HandTarget>();
  private hitZones: HandHitZone[] = [];
  private hoveredIndex: number | null = null;
  private hoveredCardId: string | null = null;
  private flippedHorizontalId: string | null = null;
  private hoverHoldTimer: number | null = null;
  private hoverHeld = false;
  private pendingLeaveIndex: number | null = null;
  private lastState: HandState | null = null;
  private vScale = 1;
  private dropActive = false;
  private hoverDebugGfx: Graphics;
  private hoverDebug = false;

  constructor(host: HandHost, parent: Container) {
    this.host = host;
    this.container = new Container();
    this.container.label = "hand";
    this.container.sortableChildren = true;
    this.container.zIndex = Z_HAND_CONTAINER;
    parent.addChild(this.container);

    this.hoverDebugGfx = new Graphics();
    this.hoverDebugGfx.eventMode = "none";
    this.hoverDebugGfx.zIndex = Z_HAND_HOVERED + 1;
    this.container.addChild(this.hoverDebugGfx);
  }

  setHoverDebug(on: boolean): void {
    this.hoverDebug = on;
    this.drawHoverDebug();
  }

  private drawHoverDebug(): void {
    this.hoverDebugGfx.clear();
    if (!this.hoverDebug) return;
    const color = hexToNum(getTheme().gameTheme.success);
    for (const zone of this.hitZones) {
      this.hoverDebugGfx.rect(
        zone.x - zone.width / 2,
        zone.y - zone.height / 2,
        zone.width,
        zone.height,
      );
      this.hoverDebugGfx.fill({ color, alpha: 0.28 });
    }
  }

  setScale(scale: number): void {
    // Shrink-only cap so a width-derived scale can't make the fan taller than
    // its region and overflow the battlefield on a short window.
    const zoneH = this.host.getPlayZone().height;
    const maxScale =
      zoneH > 0 ? (zoneH * HAND_MAX_ZONE_HEIGHT_FRACTION) / HAND_CARD_BASE.cardH : scale;
    this.vScale = Math.min(scale, maxScale);
  }

  setDropActive(active: boolean): void {
    if (this.dropActive === active) return;
    this.dropActive = active;
    this.relayout();
  }

  isDraggingPermanent(): boolean {
    return this.lastState?.draggingCardId != null && this.lastState?.draggingIsPermanent === true;
  }

  getDraggingCardId(): string | null {
    return this.lastState?.draggingCardId ?? null;
  }

  relayout(): void {
    if (this.lastState) this.updateHand(this.lastState);
  }

  updateHand(state: HandState): void {
    if (this.host.isDestroyed() || !state || !Array.isArray(state.cards)) return;
    if (!this.host.showsHand()) {
      this.hitZones = [];
      return;
    }
    this.lastState = state;
    if (this.hoveredIndex !== null && this.hoveredIndex >= state.cards.length) {
      this.hoveredIndex = null;
    }
    this.pruneRemovedSprites(new Set(state.cards.map((c) => c.id)));
    this.host.setHandExclusion(this.getBlockerRect());

    const dims = this.getDimensions();
    const baseLayout = computeBaseLayout(
      state.cards.length,
      dims.cardW,
      dims.maxSpread,
      dims.minSpread,
      dims.spreadWidth,
    );
    const layout = computeHandLayout(
      state.cards.length,
      dims.cardW,
      dims.cardH,
      dims.maxSpread,
      dims.minSpread,
      dims.spreadWidth,
      this.hoveredIndex,
      dims.hoverLift,
      dims.neighborPush,
    );

    const zone = this.host.getPlayZone();
    const centerX = zone.x + zone.width / 2;
    const bottomY = this.getBottomY();
    const hitZones: HandHitZone[] = [];

    // The fan only reshapes for a drag that originates from the hand. A card
    // dragged from the command zone sets `draggingCardId` too, but must not sink
    // the hand out of the way.
    const draggingInHand =
      state.draggingCardId != null && state.cards.some((c) => c.id === state.draggingCardId);

    for (let i = 0; i < state.cards.length; i++) {
      const card = state.cards[i]!;
      const l = layout[i]!;
      const base = baseLayout[i]!;
      const isHovered = this.hoveredIndex === i;
      const selectionMode = state.selectionMode === true;
      const isSelected = selectionMode && (state.selectedIds?.has(card.id) ?? false);
      const selectedDrop = isSelected ? Math.round(HAND_SELECTION_DROP_PX * this.vScale) : 0;

      let sprite = this.sprites.get(card.id);
      if (!sprite) {
        sprite = this.createSprite(card);
        sprite.x = centerX + l.x;
        sprite.y = bottomY + l.y - l.scaleH / 2;
        sprite.scale.set(l.scaleW / CARD_W, l.scaleH / CARD_H);
      } else {
        sprite.updateCardContent(card);
      }

      const isCastDrag = !selectionMode && card.id === state.draggingCardId;
      const isCastingPermanent = isCastDrag && state.draggingIsPermanent === true;
      const isCastingSpell = isCastDrag && state.draggingIsPermanent !== true;
      const reshapeFan =
        !selectionMode && draggingInHand && (state.draggingIsPermanent === true || this.dropActive);
      const castOffset = reshapeFan
        ? Math.round(
            (isCastingPermanent ? CAST_DRAG_CARD_DROP_PX : CAST_DRAG_HAND_SINK_PX) * this.vScale,
          )
        : 0;
      const castScale = isCastingPermanent ? CAST_DRAG_SCALE : 1;

      const isHidden = !selectionMode && (card.id === state.castingCardId || isCastingSpell);
      sprite.alpha = isHidden ? 0 : 1;
      sprite.cursor = selectionMode
        ? "pointer"
        : state.playableIds?.has(card.id)
          ? "grab"
          : "default";

      // Horizontal-frame cards (Battle / Plane / …) sit upright (rotated a
      // quarter-turn) so they fit the portrait fan; hovering + flipping turns
      // them landscape to read, and they animate back on hover-out.
      const verticalInHand = sprite.horizontalFrame && this.flippedHorizontalId !== card.id;
      let rot = isSelected || isCastingPermanent ? 0 : (l.rotation * Math.PI) / 180;
      if (verticalInHand) rot -= Math.PI / 2;
      this.targets.set(card.id, {
        x: centerX + l.x,
        y: bottomY + l.y - l.scaleH / 2 + selectedDrop + castOffset,
        rot,
        scaleX: (l.scaleW / CARD_W) * castScale,
        scaleY: (l.scaleH / CARD_H) * castScale,
        zIndex: isHovered || isCastingPermanent ? Z_HAND_HOVERED : i + 1,
      });
      hitZones.push(
        isHovered
          ? {
              index: i,
              card,
              x: centerX + l.x,
              y: bottomY + l.y - l.scaleH / 2 + selectedDrop + castOffset,
              width: l.scaleW,
              height: l.scaleH,
            }
          : {
              index: i,
              card,
              x: centerX + base.x,
              y: bottomY + base.drop - dims.cardH / 2 + selectedDrop,
              width: dims.cardW,
              height: dims.cardH,
            },
      );

      this.applyHighlight(sprite, card, isHovered, selectionMode, isSelected);
    }
    this.hitZones = hitZones;
    this.drawHoverDebug();
  }

  animate(): void {
    for (const [id, target] of this.targets) {
      const sprite = this.sprites.get(id);
      if (!sprite) continue;
      sprite.x = lerp(sprite.x, target.x, HAND_LERP, SNAP_PX);
      sprite.y = lerp(sprite.y, target.y, HAND_LERP, SNAP_PX);
      sprite.rotation = lerp(sprite.rotation, target.rot, HAND_LERP, SNAP_ROT);
      sprite.scale.set(
        lerp(sprite.scale.x, target.scaleX, HAND_LERP, SNAP_HAND_SCALE),
        lerp(sprite.scale.y, target.scaleY, HAND_LERP, SNAP_HAND_SCALE),
      );
      sprite.zIndex = target.zIndex;
    }
  }

  getCardPosition(cardId: string): ScreenPos | null {
    const sprite = this.sprites.get(cardId);
    if (!sprite) return null;
    const target = this.targets.get(cardId);
    return target ? { x: target.x, y: target.y } : { x: sprite.x, y: sprite.y };
  }

  getLiveSpriteTransform(
    cardId: string,
  ): { x: number; y: number; scaleX: number; scaleY: number } | null {
    const sprite = this.sprites.get(cardId);
    if (!sprite) return null;
    return { x: sprite.x, y: sprite.y, scaleX: sprite.scale.x, scaleY: sprite.scale.y };
  }

  hasActiveHover(): boolean {
    return this.hoveredIndex !== null || this.pendingLeaveIndex !== null;
  }

  isDraggingFromHand(): boolean {
    return !!this.lastState?.draggingCardId;
  }

  updateHoverAt(x: number, y: number): void {
    const hit = this.hitAt(x, y);
    if (!hit) {
      this.clearHover();
      return;
    }
    this.setHovered(hit);
  }

  resetHover(): void {
    this.cancelHoverHoldTimer();
    this.hoverHeld = false;
    this.host.getCallbacks().onHoverCard?.(null);
    this.host.getCallbacks().onHoverHandCard?.(null);
    this.resetHoveredFace();
    if (this.hoveredIndex !== null) {
      this.hoveredIndex = null;
      this.recalcTargets();
    }
  }

  private resetHoveredFace(): void {
    if (this.hoveredCardId === null) return;
    this.sprites.get(this.hoveredCardId)?.setPreviewFace(null);
    this.hoveredCardId = null;
    this.flippedHorizontalId = null;
  }

  setHoveredPreviewFace(face: 0 | 1): void {
    if (this.hoveredCardId === null) return;
    this.sprites.get(this.hoveredCardId)?.setPreviewFace(face);
  }

  setHoveredHorizontalFlipped(flipped: boolean): void {
    this.flippedHorizontalId = flipped ? this.hoveredCardId : null;
    this.recalcTargets();
  }

  clearHover(): void {
    const idx = this.hoveredIndex;
    if (idx === null) return;
    if (this.hoverHeld) return;
    if (this.pendingLeaveIndex === idx && this.hoverHoldTimer !== null) return;
    this.scheduleHoverCommit(idx);
  }

  holdHover(): void {
    this.hoverHeld = true;
    this.cancelHoverHoldTimer();
  }

  releaseHover(): void {
    this.hoverHeld = false;
    if (this.hoveredIndex === null) return;
    this.scheduleHoverCommit(this.hoveredIndex);
  }

  getBottomY(): number {
    const zone = this.host.getPlayZone();
    const dims = this.getDimensions();
    return zone.y + zone.height + dims.cardH * 0.45;
  }

  getOriginSeed(): { x: number; y: number; scale: number } {
    const zone = this.host.getPlayZone();
    const dims = this.getDimensions();
    const y =
      this.host.isMirrored() || !this.host.showsHand()
        ? zone.y + dims.cardH / 2
        : this.getBottomY() - dims.cardH / 2;
    return {
      x: zone.x + zone.width / 2,
      y,
      scale: dims.cardW / CARD_W,
    };
  }

  getDimensions() {
    const base = HAND_CARD_BASE;
    const params = HAND_FAN_PARAMS;
    const scale = this.vScale;
    const cardW = Math.round(base.cardW * scale);
    const available = Math.max(cardW, this.host.getPlayZone().width - cardW);
    return {
      cardW,
      cardH: Math.round(base.cardH * scale),
      hoverLift: Math.round(params.hoverLift * scale),
      neighborPush: Math.round(params.neighborPush * scale),
      maxSpread: Math.round(params.maxSpread * scale),
      minSpread: Math.round(params.minSpread * scale),
      spreadWidth: Math.min(Math.round(params.spreadWidth * scale), available),
    };
  }

  getBlockerRect(): BlockingRect | null {
    const count = this.lastState?.cards.length ?? 0;
    if (count === 0) return null;

    const dims = this.getDimensions();
    const spread =
      count <= 1
        ? 0
        : Math.max(
            dims.minSpread,
            Math.min(dims.maxSpread, Math.floor((dims.spreadWidth - dims.cardW) / (count - 1))),
          );
    const totalSpread = count <= 1 ? 0 : (count - 1) * spread;
    const handW = totalSpread + dims.cardW;
    const handH = dims.cardH;
    const zone = this.host.getPlayZone();

    const bottomY = this.getBottomY();
    const handTopY = bottomY - handH;
    const zoneBottom = zone.y + zone.height;
    const blockerTop = Math.max(zone.y, handTopY) - GAP;
    const blockerH = zoneBottom - blockerTop;
    if (blockerH <= 0) return null;
    return {
      x: zone.x + zone.width / 2 - handW / 2 - GAP,
      y: blockerTop,
      width: handW + GAP * 2,
      height: blockerH,
    };
  }

  destroy(): void {
    this.cancelHoverHoldTimer();
    for (const sprite of this.sprites.values()) safeDestroy(sprite);
    this.sprites.clear();
    this.targets.clear();
    this.hitZones = [];
    this.container.destroy({ children: true });
  }

  private pruneRemovedSprites(currentIds: Set<string>): void {
    for (const [id, sprite] of this.sprites) {
      if (currentIds.has(id)) continue;
      this.container.removeChild(sprite);
      safeDestroy(sprite);
      this.sprites.delete(id);
      this.targets.delete(id);
    }
  }

  private createSprite(card: CardDto): CardSprite {
    const sprite = new CardSprite(card, "hand");
    sprite.eventMode = "static";
    sprite.cursor = this.lastState?.playableIds?.has(card.id) ? "grab" : "default";
    sprite.onReorient = () => this.relayout();

    sprite.on("pointerdown", (e: FederatedPointerEvent) => {
      e.stopPropagation();
      if (this.lastState?.selectionMode) {
        this.host.getCallbacks().onClickCard_Hand?.(sprite.card);
        return;
      }
      if (this.lastState?.playableIds?.has(sprite.card.id)) {
        this.host.getCallbacks().onStartDrag?.(sprite.card, {
          x: e.globalX,
          y: e.globalY,
        });
      } else {
        this.host.getCallbacks().onClickCard_Hand?.(sprite.card);
      }
    });

    this.container.addChild(sprite);
    this.sprites.set(card.id, sprite);
    return sprite;
  }

  private setHovered(hit: HandHitZone): void {
    this.cancelHoverHoldTimer();
    this.pendingLeaveIndex = null;
    if (this.hoveredIndex === hit.index) return;
    this.resetHoveredFace();
    this.hoveredIndex = hit.index;
    this.hoveredCardId = hit.card.id;
    this.recalcTargets();
    const sprite = this.sprites.get(hit.card.id);
    if (!sprite) return;
    const screenBounds = this.hoveredSpriteBounds(sprite);
    this.host.getCallbacks().onHoverCard?.(hit.card, screenBounds, {
      useAnchor: true,
      placement: "top-center",
    });
    this.host.getCallbacks().onHoverHandCard?.(hit.card, screenBounds);
  }

  private hitAt(x: number, y: number): HandHitZone | null {
    let best: HandHitZone | null = null;
    let bestDistance = Infinity;
    for (const zone of this.hitZones) {
      const left = zone.x - zone.width / 2;
      const right = zone.x + zone.width / 2;
      const top = zone.y - zone.height / 2;
      const bottom = zone.y + zone.height / 2;
      if (x < left || x > right || y < top || y > bottom) continue;
      const distance = Math.abs(x - zone.x);
      if (
        distance < bestDistance ||
        (distance === bestDistance && best && zone.index > best.index)
      ) {
        best = zone;
        bestDistance = distance;
      }
    }
    return best;
  }

  private hoveredSpriteBounds(sprite: CardSprite): ScreenBounds {
    const target = this.targets.get(sprite.card.id);
    const centerX = target?.x ?? sprite.x;
    const centerY = target?.y ?? sprite.y;
    const width = CARD_W * (target?.scaleX ?? sprite.scale.x);
    const height = CARD_H * (target?.scaleY ?? sprite.scale.y);
    return {
      x: centerX - width / 2,
      y: centerY - height / 2,
      width,
      height,
    };
  }

  private scheduleHoverCommit(idx: number): void {
    this.cancelHoverHoldTimer();
    this.pendingLeaveIndex = idx;
    this.hoverHoldTimer = window.setTimeout(() => {
      this.commitHoverLeave();
    }, HAND_HOVER_HOLD_MS);
  }

  private commitHoverLeave(): void {
    this.hoverHoldTimer = null;
    this.hoverHeld = false;
    const idx = this.pendingLeaveIndex;
    this.pendingLeaveIndex = null;
    if (this.host.isDestroyed()) return;
    if (idx === null || this.hoveredIndex !== idx) return;
    this.resetHoveredFace();
    this.hoveredIndex = null;
    this.recalcTargets();
    this.host.getCallbacks().onHoverCard?.(null);
    this.host.getCallbacks().onHoverHandCard?.(null);
  }

  private cancelHoverHoldTimer(): void {
    if (this.hoverHoldTimer !== null) {
      window.clearTimeout(this.hoverHoldTimer);
      this.hoverHoldTimer = null;
    }
    this.pendingLeaveIndex = null;
  }

  private applyHighlight(
    sprite: CardSprite,
    card: CardDto,
    isHovered: boolean,
    selectionMode = false,
    isSelected = false,
  ): void {
    if (selectionMode) {
      const color = isSelected
        ? hexToNum(this.host.getTheme().gameTheme.pointer.hostile)
        : hexToNum(this.host.getTheme().gameTheme.cardRing);
      sprite.setRing(color, isSelected ? 1 : PLAYABLE_RING_ALPHA);
      return;
    }
    if (!this.lastState?.playableIds?.has(card.id)) {
      sprite.setRing(null);
      return;
    }
    const ring = hexToNum(this.host.getTheme().gameTheme.cardRing);
    if (isHovered) sprite.setHighlight(true, ring, PLAYABLE_HIGHLIGHT_ALPHA);
    else sprite.setRing(ring, PLAYABLE_RING_ALPHA);
  }

  private recalcTargets(): void {
    if (this.lastState) this.updateHand(this.lastState);
  }
}
