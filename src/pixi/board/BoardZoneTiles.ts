import {
  Container,
  Graphics,
  ImageSource,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent,
} from "pixi.js";
import type { CardDto } from "@/protocol/game";
import type { Theme } from "@/hooks/useTheme";
import { hexToNum } from "../colorUtils";
import { applyIcon } from "../panelIcons";
import { CardSprite } from "../CardSprite";
import { fetchImageElement } from "@/api/scryfall";
import { CARD_W, CARD_BACK_IMAGE_URL } from "@/components/game/game.constants";
import { CARD_RADIUS } from "../constants";

/** One on-grid zone tile (deck / graveyard / exile / command). */
export interface ZoneTileSpec {
  key: string;
  label: string;
  count: number;
  /** Top card, rendered as the tile's face (graveyard / exile / command). */
  topCard?: CardDto;
  /** Deck: render the MTG card back instead of a top card. */
  back?: boolean;
  /** Highlight colour when the zone is playable/targetable (else none). */
  highlightColor?: string;
  /** Seat colour for the commander helm badge; absent when the zone holds no
   *  commander. */
  commander?: string;
  onOpen?: () => void;
}

/** Callbacks `BoardRegion` wires up so a local drag can paint the drop grid and
 *  snap the tile to a cell. */
export interface ZoneTileHost {
  onDragMove: (centerX: number, centerY: number) => void;
  onDrop: (key: string, centerX: number, centerY: number) => void;
  onDragEnd: () => void;
}

interface Tile {
  spec: ZoneTileSpec;
  container: Container;
  outline: Graphics;
  face: CardSprite | null;
  back: Sprite | null;
  icon: Text;
  iconSprite: Sprite;
  badge: Sprite | null;
  countText: Text;
}

let cardBackTexture: Texture | null = null;
let cardBackPromise: Promise<Texture> | null = null;

function loadCardBack(): Promise<Texture> {
  if (cardBackTexture) return Promise.resolve(cardBackTexture);
  cardBackPromise ??= fetchImageElement(CARD_BACK_IMAGE_URL).then((img) => {
    cardBackTexture = new Texture({ source: new ImageSource({ resource: img }) });
    return cardBackTexture;
  });
  return cardBackPromise;
}

const DRAG_THRESHOLD_PX = 4;
const DRAG_Z = 1000;

/** Glyph per empty zone, keyed by `ZoneTileSpec.key`. */
const ZONE_ICONS: Record<string, string> = { cmd: "♛", lib: "▦" };

/** Zones drawn with a rasterised `panelIcons` SVG instead of a text glyph —
 *  the same tombstone/vortex icons the scry prompt uses. */
const ZONE_ICON_SVG: Record<string, string> = { gy: "graveyard", ex: "exile" };

/** The deck/graveyard/exile/command tiles laid out as cards on the battlefield
 *  grid. `BoardRegion` resolves each tile's grid cell and hands the placements
 *  here; tiles tap-to-open (all players) and drag-to-reposition (local only,
 *  `BoardRegion` snaps the drop to a free cell). */
export class BoardZoneTiles {
  readonly container = new Container();
  private theme: Theme;
  private host: ZoneTileHost;
  private tiles = new Map<string, Tile>();
  private specs: ZoneTileSpec[] = [];
  private placements = new Map<string, { x: number; y: number }>();
  private cardW = 0;
  private cardH = 0;
  private draggable = false;
  private drag: { tile: Tile; grabX: number; grabY: number; moved: boolean } | null = null;

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
  ): void {
    this.cardW = cardW;
    this.cardH = cardH;
    this.placements = placements;
    this.redraw();
  }

  private createTile(spec: ZoneTileSpec): Tile {
    const container = new Container();
    container.eventMode = "static";
    container.cursor = "pointer";
    const outline = new Graphics();
    const icon = new Text({ text: ZONE_ICONS[spec.key] ?? "", style: { fontSize: 24 } });
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
    container.addChild(outline, icon, iconSprite, countText);
    this.container.addChild(container);
    const tile: Tile = {
      spec,
      container,
      outline,
      face: null,
      back: null,
      icon,
      iconSprite,
      badge: null,
      countText,
    };

    container.on("pointerdown", (e: FederatedPointerEvent) => {
      if (!this.draggable) return;
      const p = this.container.toLocal(e.global);
      this.drag = { tile, grabX: p.x - container.x, grabY: p.y - container.y, moved: false };
      container.zIndex = DRAG_Z;
    });
    container.on("globalpointermove", (e: FederatedPointerEvent) => {
      if (this.drag?.tile !== tile) return;
      const p = this.container.toLocal(e.global);
      const nx = p.x - this.drag.grabX;
      const ny = p.y - this.drag.grabY;
      if (
        Math.abs(nx - container.x) > DRAG_THRESHOLD_PX ||
        Math.abs(ny - container.y) > DRAG_THRESHOLD_PX
      ) {
        this.drag.moved = true;
      }
      container.position.set(nx, ny);
      if (this.drag.moved) this.host.onDragMove(nx + this.cardW / 2, ny + this.cardH / 2);
    });
    const end = () => {
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
      tile.spec.onOpen?.();
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
        tile.back = new Sprite(cardBackTexture ?? Texture.EMPTY);
        tile.container.addChildAt(tile.back, 0);
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
        tile.face = new CardSprite(faceCard);
        tile.container.addChildAt(tile.face, 0);
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
    for (const spec of this.specs) {
      const tile = this.tiles.get(spec.key);
      const pos = this.placements.get(spec.key);
      if (!tile || !pos) continue;
      if (this.drag?.tile !== tile) tile.container.position.set(pos.x, pos.y);
      const hl = spec.highlightColor ? hexToNum(spec.highlightColor) : null;
      const hasContent = spec.count > 0;

      tile.outline.clear();

      if (hasContent) {
        tile.icon.visible = false;
        tile.iconSprite.visible = false;
        if (tile.back) {
          tile.back.visible = true;
          tile.back.width = cardW;
          tile.back.height = cardH;
          tile.back.position.set(0, 0);
        }
        if (tile.face) {
          tile.face.visible = true;
          tile.face.scale.set(cardW / CARD_W);
          tile.face.position.set(cardW / 2, cardH / 2);
        }
        tile.outline.roundRect(0, 0, cardW, cardH, CARD_RADIUS);
        tile.outline.stroke({ color: hl ?? neutral, width: hl ? 2.5 : 1, alpha: hl ? 0.95 : 0.5 });

        tile.countText.visible = true;
        tile.countText.style.fill = hexToNum(gt.textOnTinted);
        tile.countText.text = String(spec.count);
        const pillW = tile.countText.width + 12;
        const pillH = 17;
        const pillX = (cardW - pillW) / 2;
        const pillY = cardH - pillH - 3;
        tile.outline.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
        tile.outline.fill({ color: hexToNum(gt.canvas.shadow), alpha: 0.78 });
        tile.countText.position.set(cardW / 2, pillY + pillH / 2);

        if (spec.commander) {
          if (!tile.badge) {
            tile.badge = new Sprite(Texture.EMPTY);
            tile.badge.anchor.set(0.5);
            tile.container.addChild(tile.badge);
          }
          const br = Math.round(cardW * 0.19);
          const bcx = br + 3;
          const bcy = br + 3;
          tile.outline.circle(bcx, bcy, br);
          tile.outline.fill({ color: hexToNum(gt.canvas.shadow), alpha: 0.85 });
          tile.outline.circle(bcx, bcy, br);
          tile.outline.stroke({ color: hexToNum(spec.commander), width: 1.5, alpha: 0.9 });
          const bs = Math.round(br * 1.5);
          applyIcon(tile.badge, "overlord-helm", spec.commander, 64, bs, bs);
          tile.badge.position.set(bcx, bcy);
          tile.badge.visible = true;
        } else if (tile.badge) {
          tile.badge.visible = false;
        }
      } else {
        if (tile.badge) tile.badge.visible = false;
        if (tile.back) tile.back.visible = false;
        if (tile.face) tile.face.visible = false;
        tile.countText.visible = false;
        const color = hl ?? neutral;
        this.dottedRoundRect(tile.outline, cardW, cardH, CARD_RADIUS, color, hl ? 0.9 : 0.45);
        const svgKey = ZONE_ICON_SVG[spec.key];
        if (svgKey) {
          tile.icon.visible = false;
          tile.iconSprite.visible = true;
          const size = Math.round(cardW * 0.5);
          applyIcon(
            tile.iconSprite,
            svgKey,
            spec.highlightColor ?? gt.canvas.neutral,
            64,
            size,
            size,
          );
          tile.iconSprite.alpha = hl ? 0.95 : 0.55;
          tile.iconSprite.position.set(cardW / 2, cardH / 2);
        } else {
          tile.iconSprite.visible = false;
          tile.icon.visible = true;
          tile.icon.text = ZONE_ICONS[spec.key] ?? "";
          tile.icon.style = { fontSize: Math.round(cardW * 0.42), fill: color };
          tile.icon.alpha = hl ? 0.95 : 0.55;
          tile.icon.position.set(cardW / 2, cardH / 2);
        }
      }
    }
  }

  /** Dots evenly spaced along the rounded-rect perimeter — the empty-zone look. */
  private dottedRoundRect(
    g: Graphics,
    w: number,
    h: number,
    r: number,
    color: number,
    alpha: number,
  ): void {
    const SEG = 8;
    const pts: { x: number; y: number }[] = [];
    const arc = (cx: number, cy: number, from: number, to: number) => {
      for (let i = 0; i <= SEG; i++) {
        const a = from + ((to - from) * i) / SEG;
        pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
    };
    pts.push({ x: r, y: 0 }, { x: w - r, y: 0 });
    arc(w - r, r, -Math.PI / 2, 0);
    pts.push({ x: w, y: h - r });
    arc(w - r, h - r, 0, Math.PI / 2);
    pts.push({ x: r, y: h });
    arc(r, h - r, Math.PI / 2, Math.PI);
    pts.push({ x: 0, y: r });
    arc(r, r, Math.PI, Math.PI * 1.5);
    pts.push(pts[0]!);

    const segLen: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const l = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
      segLen.push(l);
      total += l;
    }
    const count = Math.max(4, Math.round(total / 7));
    const step = total / count;
    let seg = 0;
    let segStart = 0;
    for (let k = 0; k < count; k++) {
      const target = k * step;
      while (seg < segLen.length - 1 && segStart + segLen[seg]! < target) {
        segStart += segLen[seg]!;
        seg++;
      }
      const from = pts[seg]!;
      const to = pts[seg + 1]!;
      const t = segLen[seg]! === 0 ? 0 : (target - segStart) / segLen[seg]!;
      g.circle(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 1.3);
    }
    g.fill({ color, alpha });
  }

  destroy(): void {
    for (const tile of this.tiles.values()) tile.container.destroy({ children: true });
    this.tiles.clear();
    this.container.destroy({ children: true });
  }
}
