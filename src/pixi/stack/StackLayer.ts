import { Container, Graphics, Rectangle } from "pixi.js";
import { isCoarsePointer } from "@/lib/responsive";
import gsap from "gsap";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import type { Theme } from "@/hooks/useTheme";
import { CardSprite } from "../CardSprite";
import { hexToNum } from "../colorUtils";
import type { ScreenBounds, ScreenPos } from "../types";
import { HOVER_SCALE, StackCardSprite } from "./StackCardSprite";
import type { StackAnchorProvider, StackCallbacks, StackSpec } from "./stack.types";

const DIRECTION_SIGN = -1;
const CARD_WIDTH = 220;
const MAX_CARD_HEIGHT_FRAC = 0.55;
const OFFSET_X = 36;
const OFFSET_Y = 4;
const CENTER_OFFSET_Y = -60;
const HOVER_PUSH_X = 60;
// How far a card shifts when a neighbour is hovered (separate from the layout
// padding above), and the shared snappy timing for hover repositioning — the
// button rides the top card with the exact same tween, so they never desync.
const HOVER_PUSH_DIST = 42;
const HOVER_MOVE_MS = 0.16;
const HOVER_EASE = "power2.out";
const RIGHT_MARGIN = 10;

const PEEK_HOLD_S = 1.2;
// Collapse/expand/peek slide: fast, decelerating toward the end.
const COLLAPSE_MS = 0.2;
const COLLAPSE_EASE = "power3.out";
// How much of the top card stays on screen (border + a sliver) when collapsed.
const PEEK_W = 16;

const BTN_W = 18;
const BTN_H = 64;
const BTN_RADIUS = 5;
const BTN_HOVER_SCALE = 1.22;
const BTN_ARROW_W = 6;
const BTN_ARROW_H = 11;
const BTN_GAP = 6;

/** Owns the stack pile: one `StackCardSprite` per stack object, plus the
 *  pre-stack flash card. Lays the cards out as a left-staggered fan with
 *  hover-push in canvas-local coordinates, and exposes the anchor/seed seam
 *  `BoardScene` reads for arrows and fly-from-stack animations.
 *
 *  Collapsed (driven by the spec) the fan slides right until only the top card's
 *  border peeks at the screen edge — it never fully vanishes. A single toggle
 *  button sits just left of the top card and follows it through the slide, so it
 *  rides between the expanded (left) and collapsed (right) positions with the
 *  same ease; its chevron flips and it pulses while collapsed. A new card landing
 *  while collapsed triggers a transient peek (slide out, hold, slide back). While
 *  collapsed, stack arrows anchor to the button so targeting still reads on screen. */
export class StackLayer implements StackAnchorProvider {
  readonly container: Container;
  private theme: Theme;
  private readonly callbacks: StackCallbacks;
  private sprites = new Map<string, StackCardSprite>();
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

  setViewport(width: number, height: number): void {
    if (this.viewW === width && this.viewH === height) return;
    this.viewW = width;
    this.viewH = height;
    if (this.sprites.size > 0 && this.cardWidth() !== this.builtCardWidth) {
      for (const sprite of this.sprites.values()) sprite.destroy();
      this.sprites.clear();
      this.hoveredId = null;
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
          if (this.hoveredId === staleId) this.hoveredId = card.id;
          reused.setSpec(card);
          continue;
        }
        this.builtCardWidth = this.cardWidth();
        sprite = new StackCardSprite(
          this.theme,
          card,
          this.builtCardWidth,
          () => this.callbacks.onOpen(),
          (id) => this.callbacks.onTargetSpell(id),
          (id) => this.setHovered(id),
        );
        this.container.addChild(sprite.container);
        this.sprites.set(card.id, sprite);
      } else {
        sprite.setSpec(card);
      }
    }
    for (const [id, sprite] of [...this.sprites]) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.sprites.delete(id);
      if (this.hoveredId === id) this.hoveredId = null;
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

  // ── StackAnchorProvider ────────────────────────────────────────────────────
  getAnchor(stackObjectId: string): ScreenPos | null {
    if (this.effectiveCollapsed()) return this.buttonAnchor();
    const sprite = this.sprites.get(stackObjectId);
    return sprite ? sprite.getCenter() : null;
  }

  getCastingAnchor(sourceCardId: string): ScreenPos | null {
    if (this.effectiveCollapsed()) return this.buttonAnchor();
    for (const sprite of this.sprites.values()) {
      if (sprite.sourceId === sourceCardId) return sprite.getCenter();
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

  // ── Internals ──────────────────────────────────────────────────────────────
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

    const cw = this.cardWidth();
    const ch = this.cardHeight();
    const spanX = Math.max(0, n - 1) * OFFSET_X;
    const pileHeight = ch + Math.max(0, n - 1) * OFFSET_Y;
    const pileWidth = spanX + 2 * HOVER_PUSH_X + cw;

    const panelLeft = this.viewW - RIGHT_MARGIN - pileWidth;
    const panelTop = this.viewH / 2 - pileHeight / 2 + CENTER_OFFSET_Y;
    const centerY = panelTop + pileHeight / 2;

    const collapsed = this.effectiveCollapsed();
    const fanOut = !this.spec.collapsed || this.peeking;
    // Collapsed: slide right until the top card's left edge peeks PEEK_W on screen.
    const peekLeft = this.viewW - PEEK_W - HOVER_PUSH_X;
    const drawLeft = fanOut ? panelLeft : peekLeft;

    const transitioning = this.prevFanOut !== null && this.prevFanOut !== fanOut;
    this.prevFanOut = fanOut;

    const hoveredIndex =
      collapsed || this.hoveredId === null ? -1 : cards.findIndex((c) => c.id === this.hoveredId);
    const hoverMove = !transitioning && hoveredIndex !== this.prevHoveredIndex;
    this.prevHoveredIndex = hoveredIndex;

    let moveDur: number | undefined;
    let moveEase: string | undefined;
    if (transitioning) {
      moveDur = COLLAPSE_MS;
      moveEase = COLLAPSE_EASE;
    } else if (hoverMove) {
      moveDur = HOVER_MOVE_MS;
      moveEase = HOVER_EASE;
    }

    const xShift = spanX + HOVER_PUSH_X;
    cards.forEach((card, idx) => {
      const sprite = this.sprites.get(card.id);
      if (!sprite) return;
      const baseLeft = idx * OFFSET_X * DIRECTION_SIGN;
      const pushed =
        hoveredIndex < 0 || idx === hoveredIndex
          ? baseLeft
          : baseLeft + (idx < hoveredIndex ? -1 : 1) * DIRECTION_SIGN * HOVER_PUSH_DIST;
      const boxLeft = pushed + xShift;
      const boxTop = (n - 1 - idx) * OFFSET_Y;
      const cx = drawLeft + boxLeft + cw / 2;
      const cy = panelTop + boxTop + ch / 2;
      const zIndex =
        hoveredIndex < 0
          ? idx + 1
          : 200 - Math.abs(idx - hoveredIndex) * 10 + (idx === hoveredIndex ? 5 : 0);
      const flashed = this.spec.flash?.card.id === card.sourceId;
      sprite.place(cx, cy, zIndex, flashed, moveDur, moveEase);
    });

    // One toggle button just left of the top card's *effective* left edge — it
    // follows the fan's ease, the top card's hover-push, and the hover zoom (so
    // it's pushed aside when the adjacent card grows).
    const topIdx = n - 1;
    const topPushed =
      hoveredIndex < 0 || topIdx === hoveredIndex
        ? topIdx * OFFSET_X * DIRECTION_SIGN
        : topIdx * OFFSET_X * DIRECTION_SIGN +
          (topIdx < hoveredIndex ? -1 : 1) * DIRECTION_SIGN * HOVER_PUSH_DIST;
    const topScale = hoveredIndex === topIdx ? HOVER_SCALE : 1;
    const topLeftEdge = drawLeft + topPushed + xShift + cw / 2 - (cw / 2) * topScale;
    const btnTargetX = topLeftEdge - BTN_GAP - BTN_W / 2;
    this.layoutButton(n > 0, btnTargetX, centerY, transitioning);

    if (n === 0) {
      this.bounds = null;
    } else if (collapsed) {
      const halfW = (BTN_W / 2) * BTN_HOVER_SCALE + 8;
      const halfH = (BTN_H / 2) * BTN_HOVER_SCALE + 6;
      const x = btnTargetX - halfW;
      this.bounds = { x, y: centerY - halfH, width: this.viewW - x, height: halfH * 2 };
    } else {
      this.bounds = { x: panelLeft, y: panelTop, width: pileWidth, height: pileHeight };
    }

    this.layoutFlash(drawLeft, panelTop, xShift, n);
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

  private layoutFlash(drawLeft: number, panelTop: number, xShift: number, n: number): void {
    if (!this.flashSprite) return;
    const baseLeft = n > 0 ? (n - 1) * OFFSET_X * DIRECTION_SIGN : 0;
    const cx = drawLeft + baseLeft + xShift + this.cardWidth() / 2;
    const cy = panelTop + this.cardHeight() / 2;
    this.flashSprite.position.set(cx, cy);
  }
}
