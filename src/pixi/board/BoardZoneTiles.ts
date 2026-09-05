import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent,
} from "pixi.js";
import type { CardDto } from "@/protocol/game";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum } from "../colorUtils";
import { applyIcon } from "../panelIcons";
import { CardSprite, loadCardBack } from "../CardSprite";

import { CARD_W, ZONE_BADGES, ZONE_TILE_KEY } from "@/components/game/game.constants";
import { CARD_RADIUS } from "../constants";
import { LongPressGesture } from "../LongPressGesture";

export interface ZoneTileSpec {
  key: string;
  label: string;
  count: number;
  topCard?: CardDto;
  back?: boolean;
  highlightColor?: string;
  /** Seat colour for the commander helm badge; absent when the zone holds no
   *  commander. */
  commander?: string;
  commanderTax?: number;
  onOpen?: () => void;
}

export interface ZoneTileHost {
  onDragMove: (centerX: number, centerY: number) => void;
  onDrop: (key: string, centerX: number, centerY: number) => void;
  onDragEnd: () => void;
  onPreview: (
    card: CardDto | null,
    bounds?: { x: number; y: number; width: number; height: number },
  ) => void;
  isPointerTapSuppressed: (pointerId: number) => boolean;
}

interface Tile {
  spec: ZoneTileSpec;
  container: Container;
  outline: Graphics;
  stack: Graphics;
  face: CardSprite | null;
  back: Sprite | null;
  icon: Text;
  iconSprite: Sprite;
  countText: Text;
  taxText: Text;
}

const DRAG_THRESHOLD_PX = 4;
const DRAG_Z = 1000;

const MIN_ZONE_TARGET_PX = 44;

export class BoardZoneTiles {
  readonly container = new Container();
  private theme: Theme;
  private host: ZoneTileHost;
  private tiles = new Map<string, Tile>();
  private specs: ZoneTileSpec[] = [];
  private placements = new Map<string, { x: number; y: number }>();
  private cardW = 0;
  private cardH = 0;
  private hitPad = 0;
  private draggable = false;
  private drag: {
    tile: Tile;
    pointerId: number;
    grabX: number;
    grabY: number;
    moved: boolean;
  } | null = null;
  private longPress = new LongPressGesture();

  constructor(theme: Theme, host: ZoneTileHost) {
    this.theme = theme;
    this.host = host;
    this.container.sortableChildren = true;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.redraw();
  }

  setDraggable(draggable: boolean): void {
    this.draggable = draggable;
  }

  setSpecs(specs: ZoneTileSpec[]): void {
    this.specs = specs;
    const seen = new Set(specs.map((s) => s.key));
    for (const [key, tile] of [...this.tiles]) {
      if (seen.has(key)) continue;
      this.container.removeChild(tile.container);
      tile.container.destroy({ children: true });
      this.tiles.delete(key);
    }
    for (const spec of specs) {
      const tile = this.tiles.get(spec.key) ?? this.createTile(spec);
      this.tiles.set(spec.key, tile);
      tile.spec = spec;
      this.applyFace(tile);
    }
    this.redraw();
  }

  getTileCenter(key: string): { x: number; y: number } | null {
    const p = this.placements.get(key);
    if (!p) return null;
    return { x: p.x + this.cardW / 2, y: p.y + this.cardH / 2 };
  }

  setGeometry(
    cardW: number,
    cardH: number,
    placements: Map<string, { x: number; y: number }>,
    hitPad = 0,
  ): void {
    this.cardW = cardW;
    this.cardH = cardH;
    this.hitPad = hitPad;
    this.placements = placements;
    this.redraw();
  }

  private createTile(spec: ZoneTileSpec): Tile {
    const container = new Container();
    container.eventMode = "static";
    container.cursor = "pointer";
    const outline = new Graphics();
    const stack = new Graphics();
    const icon = new Text({
      text: spec.label,
      style: { fontFamily: "system-ui, sans-serif", fontSize: 10, fontWeight: "500" },
    });
    icon.anchor.set(0.5);
    const iconSprite = new Sprite(Texture.EMPTY);
    iconSprite.anchor.set(0.5);
    iconSprite.visible = false;
    const countText = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 12,
        fontWeight: "900",
        fill: hexToNum(this.theme.gameTheme.textOnTinted),
      },
    });
    countText.anchor.set(0.5);
    const taxText = new Text({
      text: "",
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        fontWeight: "700",
        fill: hexToNum(this.theme.gameTheme.textOnTinted),
      },
    });
    taxText.anchor.set(0.5);
    container.addChild(stack, outline, icon, iconSprite, countText, taxText);
    this.container.addChild(container);
    const tile: Tile = {
      spec,
      container,
      outline,
      stack,
      face: null,
      back: null,
      icon,
      iconSprite,
      countText,
      taxText,
    };

    container.on("pointerdown", (e: FederatedPointerEvent) => {
      if (tile.spec.topCard && !tile.spec.back) {
        this.longPress.start(e, tile.spec.key, () => {
          const b = tile.container.getBounds();
          this.host.onPreview(tile.spec.topCard!, {
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
          });
        });
      }
      if (!this.draggable) return;
      const p = this.container.toLocal(e.global);
      this.drag = {
        tile,
        pointerId: e.pointerId,
        grabX: p.x - container.x,
        grabY: p.y - container.y,
        moved: false,
      };
      container.zIndex = DRAG_Z;
    });
    container.on("globalpointermove", (e: FederatedPointerEvent) => {
      this.longPress.move(e.global.x, e.global.y);
      if (this.drag?.tile !== tile || this.drag.pointerId !== e.pointerId) return;
      const p = this.container.toLocal(e.global);
      const nx = p.x - this.drag.grabX;
      const ny = p.y - this.drag.grabY;
      if (
        Math.abs(nx - container.x) > DRAG_THRESHOLD_PX ||
        Math.abs(ny - container.y) > DRAG_THRESHOLD_PX
      ) {
        this.drag.moved = true;
        this.longPress.cancel();
      }
      container.position.set(nx, ny);
      if (this.drag.moved) this.host.onDragMove(nx + this.cardW / 2, ny + this.cardH / 2);
    });
    const end = (e: FederatedPointerEvent) => {
      if (this.drag && this.drag.tile !== tile) return;
      if (this.drag && this.drag.pointerId !== e.pointerId) return;
      if (this.host.isPointerTapSuppressed(e.pointerId)) {
        this.longPress.cancel();
        this.host.onPreview(null);
        if (this.drag?.tile === tile) {
          this.drag = null;
          container.zIndex = 0;
          this.host.onDragEnd();
        }
        return;
      }
      this.longPress.cancel();
      const heldForPreview = this.longPress.consumeTap(tile.spec.key);
      if (heldForPreview) this.host.onPreview(null);
      if (this.drag?.tile === tile) {
        const { moved } = this.drag;
        this.drag = null;
        container.zIndex = 0;
        if (moved) {
          this.host.onDrop(
            tile.spec.key,
            container.x + this.cardW / 2,
            container.y + this.cardH / 2,
          );
          this.host.onDragEnd();
          return;
        }
      }
      if (!heldForPreview) tile.spec.onOpen?.();
    };
    container.on("pointerup", end);
    container.on("pointerupoutside", end);
    return tile;
  }

  private applyFace(tile: Tile): void {
    const { spec } = tile;
    if (spec.back) {
      if (tile.face) {
        tile.container.removeChild(tile.face);
        tile.face.destroy();
        tile.face = null;
      }
      if (!tile.back) {
        tile.back = new Sprite(Texture.EMPTY);
        tile.container.addChildAt(tile.back, 1);
        this.ensureCardBack();
      }
      return;
    }
    if (tile.back) {
      tile.container.removeChild(tile.back);
      tile.back.destroy();
      tile.back = null;
    }
    if (spec.topCard) {
      const faceCard = { ...spec.topCard, summoningSick: false };
      if (!tile.face) {
        tile.face = new CardSprite(faceCard, "zone");
        tile.container.addChildAt(tile.face, 1);
      }
      tile.face.updateCardContent(faceCard);
    }
  }

  private ensureCardBack(): void {
    loadCardBack()
      .then((tex) => {
        for (const tile of this.tiles.values()) if (tile.back) tile.back.texture = tex;
        this.redraw();
      })
      .catch(() => {});
  }

  private redraw(): void {
    const { cardW, cardH } = this;
    if (cardW <= 0 || cardH <= 0) return;
    const gt = this.theme.gameTheme;
    const neutral = hexToNum(gt.canvas.neutral);
    const shadow = hexToNum(gt.canvas.shadow);
    const k = Math.min(1, cardW / CARD_W);
    const radius = CARD_RADIUS * k;
    const padX = Math.max(this.hitPad, (MIN_ZONE_TARGET_PX - cardW) / 2);
    const padY = Math.max(this.hitPad, (MIN_ZONE_TARGET_PX - cardH) / 2);
    for (const spec of this.specs) {
      const tile = this.tiles.get(spec.key);
      const pos = this.placements.get(spec.key);
      if (!tile || !pos) continue;
      if (this.drag?.tile !== tile) tile.container.position.set(pos.x, pos.y);
      tile.container.hitArea = new Rectangle(-padX, -padY, cardW + padX * 2, cardH + padY * 2);
      const hl = spec.highlightColor ? hexToNum(spec.highlightColor) : null;
      const hasContent = spec.count > 0;
      const isLibrary = spec.key === ZONE_TILE_KEY.library;
      const isCommand = spec.key === ZONE_TILE_KEY.command;
      const identity = spec.commander ?? gt.textMuted;
      const color = hl ?? hexToNum(identity);
      const iconKey = isCommand ? "overlord-helm" : ZONE_BADGES[spec.key]?.icon;
      const iconSize = Math.round(cardW * (hasContent ? 0.2 : 0.32));
      tile.outline.clear();
      tile.stack.clear();

      if (hasContent && isLibrary) {
        const layers = Math.min(4, Math.ceil(spec.count / 20));
        for (let layer = layers; layer > 0; layer--) {
          const offset = layer * 1.8 * k;
          tile.stack.roundRect(offset, offset, cardW, cardH, radius);
          tile.stack.fill({ color: shadow, alpha: 0.95 });
          tile.stack.stroke({ color: neutral, width: Math.max(0.75, k), alpha: 0.65 });
        }
      }
      if (tile.back) {
        tile.back.visible = hasContent;
        tile.back.width = cardW;
        tile.back.height = cardH;
        tile.back.position.set(0, 0);
      }
      if (tile.face) {
        tile.face.visible = hasContent && !!spec.topCard;
        tile.face.scale.set(cardW / CARD_W);
        tile.face.position.set(cardW / 2, cardH / 2);
      }
      tile.icon.visible = !hasContent;
      tile.icon.text = spec.label;
      tile.icon.style.fontSize = Math.max(9, Math.round(10 * k));
      tile.icon.style.fill = color;
      tile.icon.alpha = hl !== null ? 1 : 0.75;
      tile.icon.position.set(cardW / 2, cardH / 2 + iconSize * 0.8);
      tile.iconSprite.visible = !!iconKey && (!hasContent || !isLibrary);
      if (iconKey) {
        applyIcon(
          tile.iconSprite,
          iconKey,
          spec.highlightColor ?? identity,
          64,
          iconSize,
          iconSize,
        );
        tile.iconSprite.alpha = hasContent || hl !== null ? 1 : 0.7;
        tile.iconSprite.position.set(
          hasContent ? iconSize / 2 + 5 * k : cardW / 2,
          hasContent ? iconSize / 2 + 5 * k : cardH / 2 - iconSize * 0.15,
        );
      }

      if (hasContent || hl !== null || isCommand) {
        tile.outline.roundRect(0, 0, cardW, cardH, radius);
        tile.outline.stroke({
          color: hl ?? (isCommand ? color : neutral),
          width: hl !== null ? 2.5 : isCommand ? 1.5 : 1,
          alpha: hl !== null ? 0.95 : isCommand ? 0.6 : 0.35,
        });
      }
      if (!hasContent) {
        const etchY = cardH / 2 + iconSize * 1.2;
        tile.outline.moveTo(cardW * 0.35, etchY);
        tile.outline.lineTo(cardW * 0.65, etchY);
        tile.outline.stroke({ color, width: 1, alpha: 0.3 });
      } else if (tile.iconSprite.visible) {
        const badgeRadius = iconSize / 2 + 3 * k;
        tile.outline.circle(tile.iconSprite.x, tile.iconSprite.y, badgeRadius);
        tile.outline.fill({ color: shadow, alpha: 0.9 });
        if (isCommand) {
          tile.outline.stroke({ color, width: 1, alpha: 0.8 });
        }
      }

      tile.countText.visible = hasContent;
      if (hasContent) {
        tile.countText.style.fill = hexToNum(gt.textOnTinted);
        tile.countText.style.fontSize = Math.max(10, Math.round(12 * k));
        tile.countText.text = String(spec.count);
        const pillW = tile.countText.width + 12 * k;
        const pillH = Math.max(16, 18 * k);
        const pillY = cardH - pillH - 3 * k;
        tile.outline.roundRect((cardW - pillW) / 2, pillY, pillW, pillH, pillH / 2);
        tile.outline.fill({ color: shadow, alpha: 0.94 });
        tile.countText.position.set(cardW / 2, pillY + pillH / 2);
      }

      tile.taxText.visible = isCommand && spec.commanderTax !== undefined;
      if (tile.taxText.visible) {
        tile.taxText.text = `Tax +${spec.commanderTax}`;
        tile.taxText.style.fill = hexToNum(gt.textOnTinted);
        tile.taxText.style.fontSize = Math.max(9, Math.round(11 * k));
        const taxW = tile.taxText.width + 8 * k;
        const taxH = Math.max(16, 18 * k);
        const taxY = hasContent ? cardH - taxH * 2 - 5 * k : cardH - taxH - 3 * k;
        tile.outline.roundRect((cardW - taxW) / 2, taxY, taxW, taxH, taxH / 2);
        tile.outline.fill({ color: shadow, alpha: 0.94 });
        tile.outline.stroke({ color, width: 1, alpha: 0.65 });
        tile.taxText.position.set(cardW / 2, taxY + taxH / 2);
      }
    }
  }

  getAnchor(key: string): { x: number; y: number } | null {
    const tile = this.tiles.get(key);
    if (!tile || !this.placements.has(key)) return null;
    const point = tile.container.toGlobal({ x: this.cardW / 2, y: this.cardH / 2 });
    return { x: point.x, y: point.y };
  }

  cancelDrag(): void {
    if (!this.drag) return;
    this.drag.tile.container.zIndex = 0;
    this.drag = null;
    this.host.onPreview(null);
    this.longPress.reset();
    this.host.onDragEnd();
  }

  cancelDragForPointer(pointerId: number): void {
    if (this.drag?.pointerId === pointerId) this.cancelDrag();
  }

  destroy(): void {
    this.longPress.cancel();
    for (const tile of this.tiles.values()) tile.container.destroy({ children: true });
    this.tiles.clear();
    this.container.destroy({ children: true });
  }
}
