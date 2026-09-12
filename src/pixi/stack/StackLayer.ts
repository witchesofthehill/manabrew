import { Container, Graphics, Rectangle } from "pixi.js";
import { isCoarsePointer } from "@/lib/responsive";
import gsap from "gsap";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import type { Theme } from "@/hooks/useTheme";
import { CardSprite } from "../CardSprite";
import { hexToNum } from "../colorUtils";
import type { ScreenBounds, ScreenPos } from "../types";
import { HOVER_SCALE, StackCardSprite } from "./StackCardSprite";
import { computeStackLayout, reconcileStackHover } from "./stackLayout";
import type { StackAnchorProvider, StackCallbacks, StackSpec } from "./stack.types";

const CARD_WIDTH = 300;
const MAX_CARD_HEIGHT_FRAC = 0.55;
const HOVER_MOVE_MS = 0.16;
const HOVER_EASE = "power2.out";

const PEEK_HOLD_S = 1.2;
const COLLAPSE_MS = 0.2;
const COLLAPSE_EASE = "power3.out";
const BTN_W = 18;
const BTN_H = 64;
const BTN_RADIUS = 5;
const BTN_HOVER_SCALE = 1.22;
const BTN_ARROW_W = 6;
const BTN_ARROW_H = 11;
const BTN_GAP = 6;

export class StackLayer implements StackAnchorProvider {
  readonly container: Container;
  private theme: Theme;
  private readonly callbacks: StackCallbacks;
  private sprites = new Map<string, StackCardSprite>();
  private faceOverrides = new Map<string, boolean>();
  private rulesViewOverrides = new Map<string, boolean>();
  private rulesViewDefault = false;
  private spec: StackSpec = {
    cards: [],
    flash: null,
    showPreStackFlash: false,
    collapsed: false,
  };
  private hoveredId: string | null = null;
  private viewW = 0;
  private viewH = 0;
  private bounds: ScreenBounds | null = null;
  private flashSprite: CardSprite | null = null;
  private flashToken: string | null = null;

  private btn = new Container();
  private btnGlow = new Graphics();
  private btnGfx = new Graphics();
  private btnPulsing = false;
  private btnTween: gsap.core.Tween | null = null;
  private btnVisible = false;
  private btnTargetX = 0;
  private prevHoveredIndex = -1;

  private peeking = false;
  private peekTimer: gsap.core.Tween | null = null;
  private prevCardIds = new Set<string>();
  private builtCardWidth = CARD_WIDTH;
  private prevFanOut: boolean | null = null;

  private cardWidth(): number {
    if (this.viewH <= 0) return CARD_WIDTH;
    const maxW = (this.viewH * MAX_CARD_HEIGHT_FRAC * CARD_W) / CARD_H;
    return Math.min(CARD_WIDTH, maxW);
  }

  private faceScale(): number {
    return this.cardWidth() / CARD_W;
  }

  private cardHeight(): number {
    return CARD_H * this.faceScale();
  }

  constructor(theme: Theme, callbacks: StackCallbacks) {
    this.theme = theme;
    this.callbacks = callbacks;
    this.container = new Container();
    this.container.sortableChildren = true;

    this.btnGlow.eventMode = "none";
    this.btnGlow.visible = false;
    this.btnGfx.eventMode = "none";
    this.btn.addChild(this.btnGlow, this.btnGfx);
    this.btn.zIndex = 400;
    this.btn.visible = false;
    this.btn.eventMode = "static";
    this.btn.cursor = "pointer";
    const btnHitPad = isCoarsePointer() ? 16 : 6;
    this.btn.hitArea = new Rectangle(
      -(BTN_W / 2 + btnHitPad),
      -(BTN_H / 2 + btnHitPad),
      BTN_W + btnHitPad * 2,
      BTN_H + btnHitPad * 2,
    );
    this.btn.on("pointertap", () => this.callbacks.onToggleCollapsed());
    this.btn.on("pointerover", () => this.setBtnHover(true));
    this.btn.on("pointerout", () => this.setBtnHover(false));

    this.container.addChild(this.btn);
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    for (const sprite of this.sprites.values()) sprite.setTheme(theme);
    this.layout();
  }

  setRulesViewDefault(active: boolean): void {
    if (this.rulesViewDefault === active) return;
    this.rulesViewDefault = active;
    this.rulesViewOverrides.clear();
    for (const sprite of this.sprites.values()) sprite.setRulesView(active);
  }

  setViewport(width: number, height: number): void {
    if (this.viewW === width && this.viewH === height) return;
    this.viewW = width;
    this.viewH = height;
    if (this.sprites.size > 0 && this.cardWidth() !== this.builtCardWidth) {
      for (const sprite of this.sprites.values()) sprite.destroy();
      this.sprites.clear();
      if (this.hoveredId !== null) {
        this.hoveredId = null;
        this.callbacks.onHover(null);
      }
      this.prevCardIds = new Set();
      this.setSpec(this.spec);
      return;
    }
    this.layout();
  }

  setSpec(spec: StackSpec): void {
    this.spec = spec;
    const seen = new Set<string>();
    const incoming = new Set(spec.cards.map((c) => c.id));
    const reusableBySource = new Map<string, string>();
    const replacements = new Map<string, string>();
    for (const [id, sprite] of this.sprites) {
      if (!incoming.has(id)) reusableBySource.set(sprite.sourceId, id);
    }
    for (const card of spec.cards) {
      seen.add(card.id);
      let sprite = this.sprites.get(card.id);
      if (!sprite) {
        const staleId = reusableBySource.get(card.sourceId);
        const reused = staleId !== undefined ? this.sprites.get(staleId) : undefined;
        if (reused) {
          reusableBySource.delete(card.sourceId);
          this.sprites.delete(staleId!);
          this.sprites.set(card.id, reused);
          replacements.set(staleId!, card.id);
          const staleOverride = this.faceOverrides.get(staleId!);
          this.faceOverrides.delete(staleId!);
          if (staleOverride !== undefined) this.faceOverrides.set(card.id, staleOverride);
          const staleRulesViewOverride = this.rulesViewOverrides.get(staleId!);
          this.rulesViewOverrides.delete(staleId!);
          if (staleRulesViewOverride !== undefined) {
            this.rulesViewOverrides.set(card.id, staleRulesViewOverride);
          }
          const displayCard =
            staleOverride === undefined
              ? card
              : { ...card, card: { ...card.card, isTransformed: staleOverride } };
          reused.setSpec(displayCard);
          continue;
        }
        const transformed = this.faceOverrides.get(card.id);
        const displayCard =
          transformed === undefined
            ? card
            : { ...card, card: { ...card.card, isTransformed: transformed } };
        this.builtCardWidth = this.cardWidth();
        sprite = new StackCardSprite(
          this.theme,
          displayCard,
          this.builtCardWidth,
          this.rulesViewOverrides.get(card.id) ?? this.rulesViewDefault,
          () => this.callbacks.onOpen(),
          (id) => this.callbacks.onTargetSpell(id),
          (id) => this.setHovered(id),
          (id) => this.toggleRulesView(id),
          (id) => this.toggleFace(id),
        );
        this.container.addChild(sprite.container);
        this.sprites.set(card.id, sprite);
      } else {
        const transformed = this.faceOverrides.get(card.id);
        const displayCard =
          transformed === undefined
            ? card
            : { ...card, card: { ...card.card, isTransformed: transformed } };
        sprite.setSpec(displayCard);
      }
    }
    for (const [id, sprite] of [...this.sprites]) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.sprites.delete(id);
      this.faceOverrides.delete(id);
      this.rulesViewOverrides.delete(id);
    }
    const nextHoveredId = reconcileStackHover(this.hoveredId, incoming, replacements);
    if (nextHoveredId !== this.hoveredId) {
      this.hoveredId = nextHoveredId;
      this.callbacks.onHover(nextHoveredId);
    }

    const hasNewCard = spec.cards.some((c) => !this.prevCardIds.has(c.id));
    this.prevCardIds = new Set(spec.cards.map((c) => c.id));
    if (spec.collapsed && hasNewCard && spec.cards.length > 0) this.triggerPeek();

    this.syncFlash();
    this.layout();
  }

  destroy(): void {
    this.peekTimer?.kill();
    this.btnTween?.kill();
    gsap.killTweensOf(this.btnGlow);
    gsap.killTweensOf(this.btnGlow.scale);
    gsap.killTweensOf(this.btn.scale);
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    this.flashSprite?.destroy();
    this.container.destroy({ children: true });
  }

  getAnchor(stackObjectId: string, toward?: ScreenPos): ScreenPos | null {
    if (this.effectiveCollapsed()) return this.buttonAnchor();
    const sprite = this.sprites.get(stackObjectId);
    if (!sprite) return null;
    return toward ? sprite.getAnchorTowards(toward) : sprite.getCenter();
  }

  getCastingAnchor(sourceCardId: string, toward?: ScreenPos): ScreenPos | null {
    if (this.effectiveCollapsed()) return this.buttonAnchor();
    for (const sprite of this.sprites.values()) {
      if (sprite.sourceId !== sourceCardId) continue;
      return toward ? sprite.getAnchorTowards(toward) : sprite.getCenter();
    }
    return null;
  }

  getSeeds(): Array<{ cardId: string; x: number; y: number; scale: number }> {
    const seeds: Array<{ cardId: string; x: number; y: number; scale: number }> = [];
    for (const sprite of this.sprites.values()) {
      const c = sprite.getCenter();
      seeds.push({ cardId: sprite.sourceId, x: c.x, y: c.y, scale: this.faceScale() });
    }
    return seeds;
  }

  getBounds(): ScreenBounds | null {
    return this.bounds;
  }

  hitTest(x: number, y: number): boolean {
    if (!this.bounds) return false;
    if (
      x < this.bounds.x ||
      x > this.bounds.x + this.bounds.width ||
      y < this.bounds.y ||
      y > this.bounds.y + this.bounds.height
    ) {
      return false;
    }
    const over = (b: { x: number; y: number; width: number; height: number }): boolean =>
      x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
    if (this.btn.visible && over(this.btn.getBounds())) return true;
    if (this.flashSprite && over(this.flashSprite.getBounds())) return true;
    for (const sprite of this.sprites.values()) {
      if (over(sprite.container.getBounds())) return true;
    }
    return false;
  }

  toggleFace(stackObjectId: string): void {
    const card = this.spec.cards.find((candidate) => candidate.id === stackObjectId);
    if (!card?.card.isDoubleFaced) return;
    if (this.hoveredId === stackObjectId) this.setHovered(null);
    const current = this.faceOverrides.get(stackObjectId) ?? card.card.isTransformed;
    this.faceOverrides.set(stackObjectId, !current);
    this.sprites.get(stackObjectId)?.destroy();
    this.sprites.delete(stackObjectId);
    this.setSpec(this.spec);
  }

  toggleRulesView(stackObjectId: string): void {
    const sprite = this.sprites.get(stackObjectId);
    if (!sprite) return;
    const active = !sprite.usesRulesView;
    this.rulesViewOverrides.set(stackObjectId, active);
    sprite.setRulesView(active);
  }

  private effectiveCollapsed(): boolean {
    return this.spec.collapsed && !this.peeking;
  }

  private buttonAnchor(): ScreenPos | null {
    return this.btn.visible ? { x: this.btn.position.x - BTN_W / 2, y: this.btn.position.y } : null;
  }

  private triggerPeek(): void {
    this.peeking = true;
    this.peekTimer?.kill();
    this.peekTimer = gsap.delayedCall(PEEK_HOLD_S, () => {
      this.peeking = false;
      this.peekTimer = null;
      this.layout();
    });
  }

  private setHovered(id: string | null): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    this.callbacks.onHover(id);
    this.layout();
  }

  private setBtnHover(hovered: boolean): void {
    const s = hovered ? BTN_HOVER_SCALE : 1;
    gsap.to(this.btn.scale, { x: s, y: s, duration: 0.15, ease: "power2.out" });
  }

  private layout(): void {
    const cards = this.spec.cards;
    const n = cards.length;
    if (this.viewW === 0 || this.viewH === 0) return;

    const collapsed = this.effectiveCollapsed();
    const fanOut = !this.spec.collapsed || this.peeking;
    const transitioning = this.prevFanOut !== null && this.prevFanOut !== fanOut;
    this.prevFanOut = fanOut;

    const hoveredIndex =
      collapsed || this.hoveredId === null ? -1 : cards.findIndex((c) => c.id === this.hoveredId);
    const hoverMove = !transitioning && hoveredIndex !== this.prevHoveredIndex;
    this.prevHoveredIndex = hoveredIndex;
    const layout = computeStackLayout({
      viewWidth: this.viewW,
      viewHeight: this.viewH,
      cards: cards.map(
        (card) =>
          this.sprites.get(card.id)?.getSize() ?? {
            width: this.cardWidth(),
            height: this.cardHeight(),
          },
      ),
      fallbackWidth: this.cardWidth(),
      fallbackHeight: this.cardHeight(),
      flash: this.flashSprite
        ? {
            width: (this.flashSprite.horizontalFrame ? CARD_H : CARD_W) * this.faceScale(),
            height: (this.flashSprite.horizontalFrame ? CARD_W : CARD_H) * this.faceScale(),
          }
        : null,
      fanOut,
      hoveredIndex,
      hoverScale: HOVER_SCALE,
      buttonWidth: BTN_W,
      buttonGap: BTN_GAP,
    });

    let moveDur: number | undefined;
    let moveEase: string | undefined;
    if (transitioning) {
      moveDur = COLLAPSE_MS;
      moveEase = COLLAPSE_EASE;
    } else if (hoverMove) {
      moveDur = HOVER_MOVE_MS;
      moveEase = HOVER_EASE;
    }

    cards.forEach((card, idx) => {
      const sprite = this.sprites.get(card.id);
      if (!sprite) return;
      const position = layout.cards[idx]!;
      const flashed = this.spec.flash?.card.id === card.sourceId;
      sprite.place(position.x, position.y, position.zIndex, flashed, moveDur, moveEase);
    });

    this.layoutButton(n > 0, layout.buttonX, layout.centerY, transitioning);

    if (n === 0) {
      this.bounds = null;
    } else if (collapsed) {
      const halfW = (BTN_W / 2) * BTN_HOVER_SCALE + 8;
      const halfH = (BTN_H / 2) * BTN_HOVER_SCALE + 6;
      const x = layout.buttonX - halfW;
      this.bounds = {
        x,
        y: layout.centerY - halfH,
        width: this.viewW - x,
        height: halfH * 2,
      };
    } else {
      this.bounds = {
        x: layout.panelLeft,
        y: layout.panelTop,
        width: layout.pileWidth,
        height: layout.pileHeight,
      };
    }

    this.layoutFlash(layout.flash);
  }

  private layoutButton(
    show: boolean,
    targetX: number,
    centerY: number,
    transitioning: boolean,
  ): void {
    this.btn.visible = show;
    if (!show) {
      this.stopBtnPulse();
      this.btnTween?.kill();
      this.btnTween = null;
      gsap.killTweensOf(this.btn.scale);
      this.btn.scale.set(1);
      this.btnVisible = false;
      return;
    }
    this.btn.position.y = centerY;
    const justAppeared = !this.btnVisible;
    this.btnVisible = true;
    const targetMoved = Math.abs(targetX - this.btnTargetX) > 0.5;
    this.btnTargetX = targetX;
    if (justAppeared) {
      this.btnTween?.kill();
      this.btnTween = null;
      this.btn.position.x = targetX;
    } else if (transitioning) {
      this.btnTween?.kill();
      this.btnTween = gsap.to(this.btn.position, {
        x: targetX,
        duration: COLLAPSE_MS,
        ease: COLLAPSE_EASE,
      });
    } else if (targetMoved) {
      this.btnTween?.kill();
      this.btnTween = gsap.to(this.btn.position, {
        x: targetX,
        duration: HOVER_MOVE_MS,
        ease: HOVER_EASE,
      });
    }

    const color = hexToNum(this.theme.gameTheme.activeAction.active);
    this.btnGlow.clear();
    this.btnGlow
      .roundRect(-BTN_W / 2 - 4, -BTN_H / 2 - 4, BTN_W + 8, BTN_H + 8, BTN_RADIUS + 3)
      .fill({ color });
    this.drawButton(this.btnGfx, this.spec.collapsed ? "left" : "right");

    if (this.effectiveCollapsed()) this.startBtnPulse();
    else this.stopBtnPulse();
  }

  private drawButton(gfx: Graphics, chevron: "left" | "right"): void {
    const color = hexToNum(this.theme.gameTheme.activeAction.active);
    const glyph = hexToNum(this.theme.gameTheme.canvas.shadow);
    const aw = BTN_ARROW_W / 2;
    const ah = BTN_ARROW_H / 2;
    gfx.clear();
    gfx.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, BTN_RADIUS).fill({ color });
    if (chevron === "left") {
      gfx.moveTo(aw, -ah).lineTo(-aw, 0).lineTo(aw, ah);
    } else {
      gfx.moveTo(-aw, -ah).lineTo(aw, 0).lineTo(-aw, ah);
    }
    gfx.stroke({ color: glyph, width: 2.5, cap: "round", join: "round" });
  }

  private startBtnPulse(): void {
    if (this.btnPulsing) return;
    this.btnPulsing = true;
    this.btnGlow.visible = true;
    this.btnGlow.alpha = 0.4;
    this.btnGlow.scale.set(1);
    gsap.to(this.btnGlow, {
      alpha: 0.08,
      duration: 0.9,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
    });
    gsap.to(this.btnGlow.scale, {
      x: 1.5,
      y: 1.16,
      duration: 0.9,
      ease: "sine.inOut",
      yoyo: true,
      repeat: -1,
    });
  }

  private stopBtnPulse(): void {
    if (!this.btnPulsing) return;
    this.btnPulsing = false;
    gsap.killTweensOf(this.btnGlow);
    gsap.killTweensOf(this.btnGlow.scale);
    this.btnGlow.visible = false;
    this.btnGlow.alpha = 0;
    this.btnGlow.scale.set(1);
  }

  private syncFlash(): void {
    const flash = this.spec.flash;
    const landed = flash ? this.spec.cards.some((c) => c.sourceId === flash.card.id) : false;
    if (!flash || landed || !this.spec.showPreStackFlash) {
      this.flashSprite?.destroy();
      this.flashSprite = null;
      this.flashToken = null;
      return;
    }
    if (this.flashToken === flash.token) return;
    this.flashSprite?.destroy();
    this.flashToken = flash.token;
    const sprite = new CardSprite(flash.card, "hand");
    const scale = this.faceScale();
    sprite.scale.set(scale);
    sprite.zIndex = 300;
    sprite.eventMode = "none";
    this.flashSprite = sprite;
    this.container.addChild(sprite);
    gsap.fromTo(sprite, { alpha: 0 }, { alpha: 1, duration: 0.18, ease: "power2.out" });
    gsap.fromTo(
      sprite.scale,
      { x: scale * 0.84, y: scale * 0.84 },
      { x: scale, y: scale, duration: 0.42, ease: "back.out(1.6)" },
    );
  }

  private layoutFlash(position: { x: number; y: number } | null): void {
    if (!this.flashSprite || !position) return;
    this.flashSprite.position.set(position.x, position.y);
  }
}
