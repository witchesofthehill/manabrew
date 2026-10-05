import { Container, Graphics, type FederatedPointerEvent } from "pixi.js";
import type { CardDto } from "@/protocol/game";
import type { PreviewPointerInput } from "@/lib/cardPreview";
import { isFacelessCard } from "@/lib/gameCard";
import { HAND_CARD_BASE } from "@/components/game/game.styles";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import { CardSprite } from "../CardSprite";
import { computeBaseLayout, computeHandLayout, HAND_FAN_PARAMS } from "../HandLayout";
import type { ScreenBounds } from "../types";
import {
  GAP,
  HAND_HOVER_HOLD_MS,
  HAND_LERP,
  OPPONENT_HAND_SCALE,
  OPPONENT_HAND_SINK_FRAC,
  SNAP_HAND_SCALE,
  SNAP_PX,
  SNAP_ROT,
  Z_HAND_HOVERED,
  Z_OPPONENT_HAND,
} from "../constants";
import { lerp, safeDestroy } from "./pixiHelpers";
import type { HandHitZone, HandTarget } from "./types";

export interface OpponentHandFanHost {
  onHoverCard(card: CardDto | null, bounds?: ScreenBounds, trigger?: PreviewPointerInput): void;
  onInspectCard(card: CardDto): void;
}

export class OpponentHandFan {
  readonly container: Container;
  private host: OpponentHandFanHost;
  private mask: Graphics;
  private sprites = new Map<string, CardSprite>();
  private targets = new Map<string, HandTarget>();
  private hitZones: HandHitZone[] = [];
  private cards: CardDto[] = [];
  private hoveredIndex: number | null = null;
  private hoverLeaveTimer: number | null = null;
  private band = { x: 0, y: 0, width: 0, height: 0 };

  constructor(host: OpponentHandFanHost, parent: Container) {
    this.host = host;
    this.container = new Container();
    this.container.label = "opponent-hand";
    this.container.sortableChildren = true;
    this.container.zIndex = Z_OPPONENT_HAND;
    this.container.eventMode = "static";
    this.container.hitArea = {
      contains: (x, y) => y >= this.band.y && this.hitAt(x, y) !== null,
    };
    this.container.on("pointermove", this.onPointerMove);
    this.container.on("pointerleave", this.onPointerLeave);
    this.container.on("pointertap", this.onPointerTap);
    this.mask = new Graphics();
    this.container.addChild(this.mask);
    this.container.mask = this.mask;
    parent.addChild(this.container);
  }

  setCards(cards: CardDto[]): void {
    this.cards = cards;
    const ids = new Set(cards.map((card) => card.id));
    for (const [id, sprite] of this.sprites) {
      if (ids.has(id)) continue;
      safeDestroy(sprite);
      this.sprites.delete(id);
      this.targets.delete(id);
    }
    if (this.hoveredIndex !== null && this.hoveredIndex >= cards.length) this.clearHover();
    this.layout();
  }

  setBand(x: number, y: number, width: number, height: number, visible: boolean): void {
    this.container.visible = visible;
    if (!visible) this.clearHover();
    const b = this.band;
    if (b.x === x && b.y === y && b.width === width && b.height === height) return;
    this.band = { x, y, width, height };
    this.mask.clear().rect(x, y, width, height).fill(0xffffff);
    this.layout();
  }

  animate(): void {
    if (!this.container.visible) return;
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
      sprite.setChromeScale(1 / Math.max(sprite.scale.x, sprite.scale.y));
      sprite.zIndex = target.zIndex;
    }
  }

  destroy(): void {
    this.cancelHoverLeave();
    for (const sprite of this.sprites.values()) safeDestroy(sprite);
    this.sprites.clear();
    this.targets.clear();
    this.container.destroy({ children: true });
  }

  private dimensions() {
    const cardW = Math.round(HAND_CARD_BASE.cardW * OPPONENT_HAND_SCALE);
    const cardH = Math.round(HAND_CARD_BASE.cardH * OPPONENT_HAND_SCALE);
    return {
      cardW,
      cardH,
      sink: Math.round(cardH * OPPONENT_HAND_SINK_FRAC),
      hoverLift: Math.ceil(cardH * OPPONENT_HAND_SINK_FRAC) + GAP,
      neighborPush: Math.round(HAND_FAN_PARAMS.neighborPush * OPPONENT_HAND_SCALE),
      maxSpread: Math.round(HAND_FAN_PARAMS.maxSpread * OPPONENT_HAND_SCALE),
      minSpread: Math.round(HAND_FAN_PARAMS.minSpread * OPPONENT_HAND_SCALE),
      spreadWidth: Math.min(
        Math.round(HAND_FAN_PARAMS.spreadWidth * OPPONENT_HAND_SCALE),
        Math.max(cardW, this.band.width - cardW),
      ),
    };
  }

  private layout(): void {
    const dims = this.dimensions();
    const count = this.cards.length;
    const base = computeBaseLayout(
      count,
      dims.cardW,
      dims.maxSpread,
      dims.minSpread,
      dims.spreadWidth,
    );
    const layout = computeHandLayout(
      count,
      dims.cardW,
      dims.cardH,
      dims.maxSpread,
      dims.minSpread,
      dims.spreadWidth,
      this.hoveredIndex,
      dims.hoverLift,
      dims.neighborPush,
    );
    const centerX = this.band.x + this.band.width / 2;
    const topY = this.band.y - dims.sink;
    const hitZones: HandHitZone[] = [];
    for (let i = 0; i < count; i++) {
      const card = this.cards[i]!;
      const l = layout[i]!;
      const isHovered = this.hoveredIndex === i;
      const x = centerX + l.x;
      const y = topY - l.y + l.scaleH / 2;
      let sprite = this.sprites.get(card.id);
      if (!sprite) {
        sprite = new CardSprite(card, "hand");
        sprite.eventMode = "none";
        sprite.x = x;
        sprite.y = y;
        sprite.scale.set(l.scaleW / CARD_W, l.scaleH / CARD_H);
        this.container.addChild(sprite);
        this.sprites.set(card.id, sprite);
      } else {
        sprite.updateCardContent(card);
      }
      let rot = (-l.rotation * Math.PI) / 180;
      if (sprite.horizontalFrame && !isHovered) rot -= Math.PI / 2;
      this.targets.set(card.id, {
        x,
        y,
        rot,
        scaleX: l.scaleW / CARD_W,
        scaleY: l.scaleH / CARD_H,
        zIndex: isHovered ? Z_HAND_HOVERED : i + 1,
      });
      hitZones.push(
        isHovered
          ? { index: i, card, x, y, width: l.scaleW, height: l.scaleH }
          : {
              index: i,
              card,
              x: centerX + base[i]!.x,
              y: topY - base[i]!.drop + dims.cardH / 2,
              width: dims.cardW,
              height: dims.cardH,
            },
      );
    }
    this.hitZones = hitZones;
  }

  private hitAt(x: number, y: number): HandHitZone | null {
    let best: HandHitZone | null = null;
    let bestDistance = Infinity;
    for (const zone of this.hitZones) {
      if (
        x < zone.x - zone.width / 2 ||
        x > zone.x + zone.width / 2 ||
        y < zone.y - zone.height / 2 ||
        y > zone.y + zone.height / 2
      ) {
        continue;
      }
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

  private onPointerMove = (e: FederatedPointerEvent): void => {
    if (e.pointerType === "touch") return;
    const point = this.container.toLocal(e.global);
    const hit = this.hitAt(point.x, point.y);
    if (!hit) return;
    const resumed = this.hoverLeaveTimer !== null;
    this.cancelHoverLeave();
    if (this.hoveredIndex === hit.index && !resumed) return;
    this.hoveredIndex = hit.index;
    this.layout();
    this.container.cursor = isFacelessCard(hit.card) ? "default" : "zoom-in";
    if (isFacelessCard(hit.card)) {
      this.host.onHoverCard(null);
      return;
    }
    const target = this.targets.get(hit.card.id)!;
    const width = CARD_W * target.scaleX;
    const height = CARD_H * target.scaleY;
    const origin = this.container.toGlobal({ x: target.x - width / 2, y: target.y - height / 2 });
    this.host.onHoverCard(hit.card, { x: origin.x, y: origin.y, width, height }, e);
  };

  private onPointerTap = (e: FederatedPointerEvent): void => {
    const point = this.container.toLocal(e.global);
    const hit = this.hitAt(point.x, point.y);
    if (!hit || isFacelessCard(hit.card)) return;
    e.stopPropagation();
    this.host.onInspectCard(hit.card);
  };

  private onPointerLeave = (): void => {
    if (this.hoveredIndex === null) return;
    const card = this.cards[this.hoveredIndex];
    if (card && !isFacelessCard(card)) this.host.onHoverCard(null);
    this.cancelHoverLeave();
    this.hoverLeaveTimer = window.setTimeout(() => {
      this.hoverLeaveTimer = null;
      this.hoveredIndex = null;
      this.layout();
    }, HAND_HOVER_HOLD_MS);
  };

  private clearHover(): void {
    this.cancelHoverLeave();
    if (this.hoveredIndex === null) return;
    const card = this.cards[this.hoveredIndex];
    this.hoveredIndex = null;
    this.layout();
    if (card && !isFacelessCard(card)) this.host.onHoverCard(null);
  }

  private cancelHoverLeave(): void {
    if (this.hoverLeaveTimer === null) return;
    window.clearTimeout(this.hoverLeaveTimer);
    this.hoverLeaveTimer = null;
  }
}
