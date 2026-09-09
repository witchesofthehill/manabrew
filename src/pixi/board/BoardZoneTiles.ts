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
import { animationsEnabled } from "../effects/enabled";
import { gsap } from "../effects/gsap";

import { CARD_W, ZONE_BADGES, ZONE_TILE_KEY } from "@/components/game/game.constants";
import { CARD_RADIUS } from "../constants";
import { LongPressGesture } from "../LongPressGesture";

export interface ZoneTileSpec {
  key: string;
  label: string;
  count: number;
  topCard?: CardDto;
  previewCards?: CardDto[];
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
  onPreviewCards: (
    cards: CardDto[] | null,
    bounds?: { x: number; y: number; width: number; height: number },
  ) => void;
  isPointerTapSuppressed: (pointerId: number) => boolean;
}

interface ZoneParticle {
  node: Graphics;
  phase: number;
  lane: number;
}

interface Tile {
  spec: ZoneTileSpec;
  container: Container;
  outline: Graphics;
  stack: Graphics;
  hoverGlow: Graphics;
  ambient: Container;
  aura: Graphics;
  particles: ZoneParticle[];
  face: CardSprite | null;
  renderedTopCard: CardDto | null;
  back: Sprite | null;
  backMask: Graphics | null;
  icon: Text;
  iconSprite: Sprite;
  countText: Text;
  taxText: Text;
  hovered: boolean;
}

const DRAG_THRESHOLD_PX = 4;
const DRAG_Z = 1000;

const MIN_ZONE_TARGET_PX = 44;
const ZONE_SKELETON_ARC_SEGMENTS = 8;
const ZONE_SKELETON_DOT_SPACING_PX = 7;
const ZONE_SKELETON_DOT_RADIUS_PX = 1.3;
const ZONE_SKELETON_MIN_DOTS = 4;
const ZONE_SKELETON_ALPHA = 0.45;
const ZONE_PARTICLE_COUNT = 7;
const ZONE_HOVER_SECONDS = 0.16;
const TAU = Math.PI * 2;
function drawDottedRoundRect(
  graphics: Graphics,
  width: number,
  height: number,
  radius: number,
  color: number,
): void {
  const points: { x: number; y: number }[] = [];
  const addArc = (centerX: number, centerY: number, from: number, to: number) => {
    for (let i = 0; i <= ZONE_SKELETON_ARC_SEGMENTS; i++) {
      const angle = from + ((to - from) * i) / ZONE_SKELETON_ARC_SEGMENTS;
      points.push({
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    }
  };
  points.push({ x: radius, y: 0 }, { x: width - radius, y: 0 });
  addArc(width - radius, radius, -Math.PI / 2, 0);
  points.push({ x: width, y: height - radius });
  addArc(width - radius, height - radius, 0, Math.PI / 2);
  points.push({ x: radius, y: height });
  addArc(radius, height - radius, Math.PI / 2, Math.PI);
  points.push({ x: 0, y: radius });
  addArc(radius, radius, Math.PI, Math.PI * 1.5);
  points.push(points[0]!);

  const segmentLengths: number[] = [];
  let perimeter = 0;
  for (let i = 1; i < points.length; i++) {
    const length = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    segmentLengths.push(length);
    perimeter += length;
  }

  const dotCount = Math.max(
    ZONE_SKELETON_MIN_DOTS,
    Math.round(perimeter / ZONE_SKELETON_DOT_SPACING_PX),
  );
  const dotSpacing = perimeter / dotCount;
  let segment = 0;
  let segmentStart = 0;
  for (let i = 0; i < dotCount; i++) {
    const target = i * dotSpacing;
    while (
      segment < segmentLengths.length - 1 &&
      segmentStart + segmentLengths[segment]! < target
    ) {
      segmentStart += segmentLengths[segment]!;
      segment++;
    }
    const from = points[segment]!;
    const to = points[segment + 1]!;
    const segmentLength = segmentLengths[segment]!;
    const progress = segmentLength === 0 ? 0 : (target - segmentStart) / segmentLength;
    graphics.circle(
      from.x + (to.x - from.x) * progress,
      from.y + (to.y - from.y) * progress,
      ZONE_SKELETON_DOT_RADIUS_PX,
    );
  }
  graphics.fill({ color, alpha: ZONE_SKELETON_ALPHA });
}

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
  private destroyed = false;
  private cardBackRequest: Promise<void> | null = null;
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
    for (const tile of this.tiles.values()) {
      tile.container.cursor = tile.spec.onOpen ? "pointer" : draggable ? "grab" : "default";
    }
  }

  setSpecs(specs: ZoneTileSpec[]): void {
    this.specs = specs;
    const seen = new Set(specs.map((s) => s.key));
    for (const [key, tile] of [...this.tiles]) {
      if (seen.has(key)) continue;
      gsap.killTweensOf(tile.hoverGlow);
      gsap.killTweensOf(tile.ambient);
      if (tile.spec.previewCards?.length) this.host.onPreviewCards(null);
      this.container.removeChild(tile.container);
      tile.container.destroy({ children: true });
      this.tiles.delete(key);
    }
    for (const spec of specs) {
      const tile = this.tiles.get(spec.key) ?? this.createTile(spec);
      this.tiles.set(spec.key, tile);
      tile.spec = spec;
      tile.container.cursor = spec.onOpen ? "pointer" : this.draggable ? "grab" : "default";
      if (!spec.onOpen) this.setHovered(tile, false);
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
    container.interactiveChildren = false;
    container.cursor = spec.onOpen ? "pointer" : this.draggable ? "grab" : "default";
    const outline = new Graphics();
    const stack = new Graphics();
    const hoverGlow = new Graphics();
    hoverGlow.eventMode = "none";
    hoverGlow.blendMode = "add";
    hoverGlow.alpha = 0;
    const ambient = new Container();
    ambient.eventMode = "none";
    ambient.visible = false;
    ambient.alpha = 0.78;
    const aura = new Graphics();
    aura.blendMode = "add";
    ambient.addChild(aura);
    const particles: ZoneParticle[] = [];
    for (let index = 0; index < ZONE_PARTICLE_COUNT; index++) {
      const node = new Graphics();
      node.eventMode = "none";
      node.blendMode = "add";
      ambient.addChild(node);
      particles.push({
        node,
        phase: index / ZONE_PARTICLE_COUNT,
        lane: ((index * 3) % ZONE_PARTICLE_COUNT) / (ZONE_PARTICLE_COUNT - 1),
      });
    }
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
    container.addChild(stack, ambient, hoverGlow, outline, icon, iconSprite, countText, taxText);
    this.container.addChild(container);
    const tile: Tile = {
      spec,
      container,
      outline,
      stack,
      hoverGlow,
      ambient,
      aura,
      particles,
      face: null,
      renderedTopCard: null,
      back: null,
      backMask: null,
      icon,
      iconSprite,
      countText,
      taxText,
      hovered: false,
    };

    container.on("pointerenter", (event: FederatedPointerEvent) => {
      if (event.pointerType === "touch") return;
      if (tile.spec.onOpen) this.setHovered(tile, true);
      if (tile.spec.previewCards?.length) this.showPreviewCards(tile);
    });
    container.on("pointerleave", () => {
      this.setHovered(tile, false);
      if (tile.spec.previewCards?.length) this.host.onPreviewCards(null);
    });
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
        !this.drag.moved &&
        (Math.abs(nx - container.x) > DRAG_THRESHOLD_PX ||
          Math.abs(ny - container.y) > DRAG_THRESHOLD_PX)
      ) {
        this.drag.moved = true;
        this.host.onPreviewCards(null);
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
  private showPreviewCards(tile: Tile): void {
    const cards = tile.spec.previewCards;
    if (!cards?.length) {
      this.host.onPreviewCards(null);
      return;
    }
    const bounds = tile.container.getBounds();
    this.host.onPreviewCards(cards, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  }

  private setHovered(tile: Tile, hovered: boolean): void {
    if (tile.hovered === hovered) return;
    tile.hovered = hovered;
    gsap.killTweensOf(tile.hoverGlow);
    gsap.killTweensOf(tile.ambient);
    if (!animationsEnabled()) {
      tile.hoverGlow.alpha = hovered ? 1 : 0;
      tile.ambient.alpha = hovered ? 1 : 0.78;
      return;
    }
    gsap.to(tile.hoverGlow, {
      alpha: hovered ? 1 : 0,
      duration: ZONE_HOVER_SECONDS,
      ease: hovered ? "power2.out" : "power1.out",
    });
    gsap.to(tile.ambient, {
      alpha: hovered ? 1 : 0.78,
      duration: ZONE_HOVER_SECONDS,
      ease: "power1.out",
    });
  }

  private ambientColor(tile: Tile): number {
    const gt = this.theme.gameTheme;
    switch (tile.spec.key) {
      case ZONE_TILE_KEY.library:
        return hexToNum(gt.counter.page);
      case ZONE_TILE_KEY.graveyard:
        return hexToNum(gt.canvas.neutral);
      case ZONE_TILE_KEY.exile:
        return hexToNum(gt.cardStatus.transformed);
      case ZONE_TILE_KEY.command:
        return hexToNum(tile.spec.commander ?? gt.badges.monarch);
      default:
        return hexToNum(gt.cardRing);
    }
  }

  private drawTileEffects(
    tile: Tile,
    scale: number,
    radius: number,
    highlightColor: number | null,
  ): void {
    const width = this.cardW;
    const height = this.cardH;
    const hoverColor = highlightColor ?? hexToNum(this.theme.gameTheme.cardRing);
    const ambientColor = this.ambientColor(tile);
    tile.hoverGlow
      .clear()
      .roundRect(-3 * scale, -3 * scale, width + 6 * scale, height + 6 * scale, radius)
      .stroke({ color: hoverColor, width: Math.max(3, 4 * scale), alpha: 0.22 })
      .roundRect(-scale, -scale, width + 2 * scale, height + 2 * scale, radius)
      .stroke({ color: hoverColor, width: Math.max(1, 1.4 * scale), alpha: 0.9 });

    tile.aura.clear();
    tile.aura.position.set(width / 2, height / 2);
    if (tile.face || tile.back) {
      const gap = Math.max(2.5, 3 * scale);
      tile.aura
        .roundRect(
          -width / 2 - gap * 1.7,
          -height / 2 - gap * 1.7,
          width + gap * 3.4,
          height + gap * 3.4,
          radius + gap * 1.7,
        )
        .stroke({ color: ambientColor, width: Math.max(5, 7 * scale), alpha: 0.1 })
        .roundRect(
          -width / 2 - gap,
          -height / 2 - gap,
          width + gap * 2,
          height + gap * 2,
          radius + gap,
        )
        .stroke({ color: ambientColor, width: Math.max(1, 1.5 * scale), alpha: 0.58 });
    } else {
      switch (tile.spec.key) {
        case ZONE_TILE_KEY.library:
          tile.aura
            .moveTo(-width * 0.22, -height * 0.08)
            .bezierCurveTo(
              -width * 0.08,
              -height * 0.13,
              width * 0.08,
              -height * 0.03,
              width * 0.22,
              -height * 0.08,
            )
            .stroke({ color: ambientColor, width: Math.max(1.25, 1.5 * scale), alpha: 0.48 })
            .moveTo(-width * 0.18, 0)
            .bezierCurveTo(
              -width * 0.06,
              -height * 0.04,
              width * 0.06,
              height * 0.04,
              width * 0.18,
              0,
            )
            .stroke({ color: ambientColor, width: Math.max(1, 1.25 * scale), alpha: 0.36 });
          break;
        case ZONE_TILE_KEY.graveyard:
          tile.aura
            .arc(0, height * 0.08, width * 0.22, Math.PI * 1.08, Math.PI * 1.92)
            .stroke({ color: ambientColor, width: Math.max(1.25, 1.5 * scale), alpha: 0.42 });
          break;
        case ZONE_TILE_KEY.exile:
          tile.aura
            .ellipse(0, 0, width * 0.3, height * 0.18)
            .stroke({ color: ambientColor, width: Math.max(1.25, 1.5 * scale), alpha: 0.52 })
            .ellipse(0, 0, width * 0.18, height * 0.1)
            .stroke({ color: ambientColor, width: Math.max(1, 1.25 * scale), alpha: 0.38 });
          break;
        case ZONE_TILE_KEY.command:
          tile.aura
            .circle(0, 0, width * 0.27)
            .stroke({ color: ambientColor, width: Math.max(1.25, 1.5 * scale), alpha: 0.48 })
            .star(0, 0, 4, width * 0.31, width * 0.27, Math.PI / 4)
            .stroke({ color: ambientColor, width: Math.max(1, 1.25 * scale), alpha: 0.32 });
          break;
      }
    }
    tile.particles.forEach(({ node }, index) => {
      const particleRadius = Math.max(1.35, scale * (1.35 + (index % 3) * 0.45));
      node
        .clear()
        .circle(0, 0, particleRadius * 2.4)
        .fill({ color: ambientColor, alpha: 0.2 })
        .circle(0, 0, particleRadius)
        .fill({ color: ambientColor, alpha: 0.95 });
    });
  }

  animate(now: number, motionEnabled: boolean): void {
    if (this.cardW <= 0 || this.cardH <= 0) return;
    const seconds = now / 1000;
    for (const tile of this.tiles.values()) {
      tile.ambient.visible = motionEnabled;
      if (!motionEnabled) continue;
      const hasCard = tile.face !== null || tile.back !== null;
      if (hasCard) {
        const pulse = (Math.sin(seconds * 2.2 + tile.particles[0]!.phase * TAU) + 1) / 2;
        tile.aura.alpha = 0.55 + pulse * 0.35;
        tile.aura.rotation = 0;
        tile.aura.scale.set(0.99 + pulse * 0.025);
        for (const particle of tile.particles) particle.node.visible = false;
        continue;
      }
      tile.aura.alpha = 0.78 + Math.sin(seconds * 1.1 + tile.particles[0]!.phase * TAU) * 0.18;
      tile.aura.rotation =
        tile.spec.key === ZONE_TILE_KEY.exile
          ? seconds * 0.14
          : tile.spec.key === ZONE_TILE_KEY.command
            ? -seconds * 0.08
            : 0;
      tile.aura.scale.set(1);
      tile.particles.forEach((particle, index) => {
        particle.node.visible = true;
        const phase = particle.phase * TAU;
        if (tile.spec.key === ZONE_TILE_KEY.library) {
          const progress = (seconds * 0.12 + particle.phase) % 1;
          particle.node.position.set(
            this.cardW * (0.16 + particle.lane * 0.68) + Math.sin(seconds * 1.4 + phase) * 3,
            this.cardH * (0.9 - progress * 0.8),
          );
          particle.node.alpha = 0.12 + Math.sin(Math.PI * progress) * 0.38;
          particle.node.scale.set(0.78 + progress * 0.42);
        } else if (tile.spec.key === ZONE_TILE_KEY.graveyard) {
          const progress = (seconds * 0.085 + particle.phase) % 1;
          particle.node.position.set(
            this.cardW * (0.16 + particle.lane * 0.68) + Math.sin(seconds + phase) * 4,
            this.cardH * (0.1 + progress * 0.78),
          );
          particle.node.alpha = 0.1 + Math.sin(Math.PI * progress) * 0.3;
          particle.node.scale.set(1.2 - progress * 0.42);
        } else {
          const speed = tile.spec.key === ZONE_TILE_KEY.exile ? 0.6 : -0.42;
          const angle = seconds * speed + phase;
          const orbitX = this.cardW * (tile.spec.key === ZONE_TILE_KEY.exile ? 0.3 : 0.27);
          const orbitY = this.cardH * (tile.spec.key === ZONE_TILE_KEY.exile ? 0.2 : 0.16);
          particle.node.position.set(
            this.cardW / 2 + Math.cos(angle) * orbitX,
            this.cardH / 2 + Math.sin(angle) * orbitY,
          );
          particle.node.alpha = 0.18 + (Math.sin(angle * 2 + index) + 1) * 0.14;
          particle.node.scale.set(0.82 + (Math.sin(angle + index) + 1) * 0.16);
        }
      });
    }
  }
  private applyFace(tile: Tile): void {
    const { spec } = tile;
    if (spec.back) {
      if (tile.face) {
        tile.container.removeChild(tile.face);
        tile.face.destroy();
        tile.renderedTopCard = null;
        tile.face = null;
      }
      if (!tile.back) {
        tile.back = new Sprite(Texture.EMPTY);
        tile.backMask = new Graphics();
        tile.backMask.eventMode = "none";
        tile.back.mask = tile.backMask;
        tile.container.addChildAt(tile.back, 3);
        tile.container.addChildAt(tile.backMask, 4);
      }
      if (tile.back.texture === Texture.EMPTY) this.ensureCardBack();
      return;
    }
    if (tile.back) {
      tile.back.mask = null;
      tile.container.removeChild(tile.back);
      tile.back.destroy();
      tile.back = null;
      if (tile.backMask) {
        tile.container.removeChild(tile.backMask);
        tile.backMask.destroy();
        tile.backMask = null;
      }
    }
    if (spec.topCard && tile.renderedTopCard !== spec.topCard) {
      const faceCard = { ...spec.topCard, summoningSick: false };
      if (!tile.face) {
        tile.face = new CardSprite(faceCard, "zone");
        tile.container.addChildAt(tile.face, 3);
      } else {
        tile.face.updateCardContent(faceCard);
      }
      tile.renderedTopCard = spec.topCard;
    }
  }

  private ensureCardBack(): void {
    if (this.cardBackRequest) return;
    this.cardBackRequest = loadCardBack()
      .then((texture) => {
        if (this.destroyed) return;
        for (const tile of this.tiles.values()) if (tile.back) tile.back.texture = texture;
        this.redraw();
      })
      .catch(() => {})
      .finally(() => {
        this.cardBackRequest = null;
      });
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
      const hasEmptySkeleton =
        !hasContent && (spec.key === ZONE_TILE_KEY.graveyard || spec.key === ZONE_TILE_KEY.exile);
      const identity = spec.commander ?? gt.textMuted;
      const color = hl ?? hexToNum(identity);
      const iconKey = isCommand ? "overlord-helm" : ZONE_BADGES[spec.key]?.icon;
      const iconSize = Math.round(cardW * (hasContent ? 0.2 : 0.32));
      tile.outline.clear();
      tile.stack.clear();
      this.drawTileEffects(tile, k, radius, hl);

      if (hasContent && isLibrary) {
        const layers = Math.min(4, Math.ceil(spec.count / 20));
        for (let layer = layers; layer > 0; layer--) {
          const offset = layer * 1.8 * k;
          tile.stack.roundRect(offset, offset, cardW, cardH, radius);
          tile.stack.fill({ color: shadow, alpha: 0.95 });
          tile.stack.stroke({
            color: hexToNum(gt.canvas.background),
            width: Math.max(0.75, k),
            alpha: 0.9,
          });
        }
      }
      if (tile.back) {
        tile.back.visible = hasContent;
        tile.back.width = cardW;
        tile.back.height = cardH;
        tile.back.position.set(0, 0);
        tile.backMask?.clear().roundRect(0, 0, cardW, cardH, radius).fill({ color: shadow });
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

      if ((hasContent && !isLibrary) || hl !== null || isCommand) {
        tile.outline.roundRect(0, 0, cardW, cardH, radius);
        tile.outline.stroke({
          color: hl ?? (isCommand ? color : neutral),
          width: hl !== null ? 2.5 : isCommand ? 1.5 : 1,
          alpha: hl !== null ? 0.95 : isCommand ? 0.6 : 0.35,
        });
      } else if (hasEmptySkeleton) {
        drawDottedRoundRect(tile.outline, cardW, cardH, radius, neutral);
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
    this.host.onPreviewCards(null);
    this.longPress.reset();
    this.host.onDragEnd();
  }

  cancelDragForPointer(pointerId: number): void {
    if (this.drag?.pointerId === pointerId) this.cancelDrag();
  }

  destroy(): void {
    this.destroyed = true;
    this.longPress.cancel();
    this.host.onPreviewCards(null);
    for (const tile of this.tiles.values()) {
      gsap.killTweensOf(tile.hoverGlow);
      gsap.killTweensOf(tile.ambient);
      tile.container.destroy({ children: true });
    }
    this.tiles.clear();
    this.container.destroy({ children: true });
  }
}
