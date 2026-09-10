import { Container, Graphics, Rectangle, type FederatedPointerEvent } from "pixi.js";
import { gsap } from "../effects/gsap";
import { CARD_W, CARD_H, CARD_RADIUS } from "@/components/game/game.constants";
import type { Theme } from "@/hooks/useTheme";
import { CardSprite } from "../CardSprite";
import { hexToNum } from "../colorUtils";
import { LongPressGesture } from "../LongPressGesture";
import { animationsEnabled } from "../effects/enabled";
import { rulesCardRadius } from "../cardPreview/rulesPreviewFrame";
import type { StackCardSpec } from "./stack.types";
import { HandCardControls } from "../HandCardControls";
import { getRectBorderAnchor } from "./stackLayout";

const ENTER_MS = 0.42;
const FLASH_MS = 0.56;
const MOVE_MS = 0.56;
const MOVE_EASE = "cubic-bezier(0.23,0.63,0.32,1)";
const CASTING_PULSE_MS = 1;
export const HOVER_SCALE = 1.12;
const HOVER_LIFT_PX = 2;
const GLOW_PAD = 6;

export class StackCardSprite {
  readonly container: Container;
  readonly sourceId: string;
  private theme: Theme;
  private spec: StackCardSpec;
  private readonly width: number;
  private readonly height: number;
  private readonly faceScale: number;
  private glow = new Graphics();
  private promptReference = new Graphics();
  private ring = new Graphics();
  private face: CardSprite;
  private hovered = false;
  private entered = false;
  private lastTargetKey = "";
  private moveTween: gsap.core.Tween | null = null;
  private castingTween: gsap.core.Tween | null = null;
  private hoverTween: gsap.core.Tween | null = null;
  private promptReferenceTween: gsap.core.Tween | null = null;
  private promptReferenceColor: number | null = null;
  private longPress = new LongPressGesture();
  private touchPointerId: number | null = null;
  private viewControls: HandCardControls;
  private readonly onToggleRules: (id: string) => void;
  private readonly onFlip: (id: string) => void;

  constructor(
    theme: Theme,
    spec: StackCardSpec,
    cardWidth: number,
    rulesView: boolean,
    onOpen: () => void,
    onTarget: (id: string) => void,
    onHover: (id: string | null) => void,
    onToggleRules: (id: string) => void,
    onFlip: (id: string) => void,
  ) {
    this.theme = theme;
    this.spec = spec;
    this.sourceId = spec.sourceId;
    this.onToggleRules = onToggleRules;
    this.onFlip = onFlip;
    this.faceScale = cardWidth / CARD_W;

    this.container = new Container();
    this.glow.eventMode = "none";
    this.ring.eventMode = "none";
    this.promptReference.eventMode = "none";
    this.face = new CardSprite(spec.card, "hand");
    this.face.scale.set(this.faceScale);
    this.face.setHandRulesView(rulesView);
    this.face.setHandRulesHighlight(spec.sourceAbilityText ?? "");
    this.face.on("pointerdown", (event: FederatedPointerEvent) => {
      if (this.face.usesHandRulesView) event.stopPropagation();
    });
    this.face.on("pointertap", (event: FederatedPointerEvent) => {
      if (this.face.usesHandRulesView) event.stopPropagation();
    });
    this.viewControls = new HandCardControls(theme);
    this.face.position.set(0, 0);

    const horiz = this.face.horizontalFrame;
    this.width = (horiz ? CARD_H : CARD_W) * this.faceScale;
    this.height = (horiz ? CARD_W : CARD_H) * this.faceScale;

    this.container.eventMode = "dynamic";
    this.container.cursor = "pointer";
    this.container.hitArea = new Rectangle(
      -this.width / 2,
      -this.height / 2,
      this.width,
      this.height,
    );
    this.container.on("pointertap", () => {
      if (this.longPress.consumeTap(this.spec.id)) return;
      if (this.spec.isValidTarget) onTarget(this.spec.id);
      else onOpen();
    });
    this.container.on("pointerdown", (event: FederatedPointerEvent) => {
      if (event.pointerType === "touch") this.touchPointerId = event.pointerId;
      this.longPress.start(event, this.spec.id, () => {
        this.hovered = true;
        this.syncControls();
        this.applyHover();
        onHover(this.spec.id);
      });
    });
    this.container.on("globalpointermove", (event: FederatedPointerEvent) => {
      if (event.pointerId === this.touchPointerId) {
        this.longPress.move(event.global.x, event.global.y);
      }
    });
    const endTouch = (event: FederatedPointerEvent) => {
      if (event.pointerId !== this.touchPointerId) return;
      this.touchPointerId = null;
      this.longPress.cancel();
      this.longPress.releaseFired();
    };
    this.container.on("pointerup", endTouch);
    this.container.on("pointerupoutside", endTouch);
    this.container.on("pointercancel", endTouch);
    this.container.on("pointerenter", (event: FederatedPointerEvent) => {
      if (event.pointerType === "touch") return;
      this.hovered = true;
      this.syncControls();
      this.applyHover();
      onHover(this.spec.id);
    });
    this.container.on("pointerleave", () => {
      this.hovered = false;
      this.syncControls();
      this.applyHover();
      onHover(null);
    });

    this.container.addChild(
      this.glow,
      this.face,
      this.ring,
      this.promptReference,
      this.viewControls,
    );
    this.syncControls();
    this.redraw();
  }

  scrollRules(delta: number, mode: number): boolean {
    return this.face.scrollHandRules(delta, mode);
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.viewControls.setTheme(theme);
    this.redraw();
  }

  setSpec(spec: StackCardSpec): void {
    const ringChanged =
      spec.seatColor !== this.spec.seatColor ||
      spec.isCasting !== this.spec.isCasting ||
      spec.isTopOfStack !== this.spec.isTopOfStack ||
      spec.isValidTarget !== this.spec.isValidTarget;
    const controlsChanged =
      spec.id !== this.spec.id ||
      spec.card.isDoubleFaced !== this.spec.card.isDoubleFaced ||
      spec.card.isTransformed !== this.spec.card.isTransformed;
    const dimChanged = spec.isDimmed !== this.spec.isDimmed;
    this.spec = spec;
    this.face.updateCardContent(spec.card);
    this.face.setHandRulesHighlight(spec.sourceAbilityText ?? "");
    if (controlsChanged) this.syncControls();
    if (dimChanged) this.container.alpha = spec.isDimmed ? 0.6 : 1;
    if (ringChanged) this.redraw();
  }

  setPromptReference(color: number | null): void {
    this.promptReferenceColor = color;
    this.promptReferenceTween?.kill();
    this.promptReferenceTween = null;
    this.promptReference.clear();
    this.promptReference.alpha = 1;
    if (color == null) return;
    const radius = this.cardRadius();
    const halfWidth = this.width / 2;
    const halfHeight = this.height / 2;
    this.promptReference
      .roundRect(
        -halfWidth - GLOW_PAD,
        -halfHeight - GLOW_PAD,
        this.width + GLOW_PAD * 2,
        this.height + GLOW_PAD * 2,
        radius + GLOW_PAD,
      )
      .stroke({ color, width: 8, alpha: 0.2 });
    this.promptReference
      .roundRect(-halfWidth - 2, -halfHeight - 2, this.width + 4, this.height + 4, radius + 2)
      .stroke({ color, width: 3, alpha: 0.95 });
    if (animationsEnabled()) {
      this.promptReferenceTween = gsap.fromTo(
        this.promptReference,
        { alpha: 0.62 },
        { alpha: 1, duration: 0.65, ease: "sine.inOut", repeat: -1, yoyo: true },
      );
    }
  }

  place(
    x: number,
    y: number,
    zIndex: number,
    flashed: boolean,
    durationS = MOVE_MS,
    ease: string = MOVE_EASE,
  ): void {
    this.container.zIndex = zIndex;
    const ty = y - (this.hovered ? HOVER_LIFT_PX : 0);
    const key = `${x},${ty},${zIndex}`;
    if (this.entered && key === this.lastTargetKey) return;
    this.lastTargetKey = key;
    if (!this.entered) {
      this.entered = true;
      this.container.position.set(x, flashed ? y : y + 8);
      this.container.alpha = this.spec.isDimmed ? 0.6 : 0;
      gsap.fromTo(
        this.face.scale,
        {
          x: this.faceScale * (flashed ? 0.84 : 0.88),
          y: this.faceScale * (flashed ? 0.84 : 0.88),
        },
        {
          x: this.faceScale,
          y: this.faceScale,
          duration: flashed ? FLASH_MS : ENTER_MS,
          ease: "back.out(1.6)",
        },
      );
      gsap.to(this.container, {
        alpha: this.spec.isDimmed ? 0.6 : 1,
        duration: flashed ? FLASH_MS : ENTER_MS,
        ease: "power2.out",
      });
      gsap.to(this.container.position, { y: ty, duration: ENTER_MS, ease: "power2.out" });
      return;
    }
    this.moveTween?.kill();
    this.moveTween = gsap.to(this.container.position, {
      x,
      y: ty,
      duration: durationS,
      ease,
    });
  }

  getCenter(): { x: number; y: number } {
    return { x: this.container.position.x, y: this.container.position.y };
  }

  getAnchorTowards(toward: { x: number; y: number }): { x: number; y: number } {
    return getRectBorderAnchor(
      this.getCenter(),
      this.width * Math.abs(this.container.scale.x),
      this.height * Math.abs(this.container.scale.y),
      toward,
    );
  }

  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  cancelPointer(pointerId: number): void {
    if (pointerId !== this.touchPointerId) return;
    this.touchPointerId = null;
    this.longPress.cancel();
    this.longPress.releaseFired();
  }

  isAnimating(): boolean {
    return (
      this.face.usesHandRulesView ||
      !this.face.imageSettled ||
      gsap.isTweening(this.face.scale) ||
      gsap.isTweening(this.container) ||
      gsap.isTweening(this.container.position) ||
      gsap.isTweening(this.container.scale) ||
      gsap.isTweening(this.ring)
    );
  }

  get usesRulesView(): boolean {
    return this.face.usesHandRulesView;
  }

  setRulesView(active: boolean): void {
    if (this.face.usesHandRulesView === active) return;
    this.face.setHandRulesView(active);
    this.syncControls();
    this.redraw();
    if (this.promptReferenceColor != null) this.setPromptReference(this.promptReferenceColor);
  }

  destroy(): void {
    this.longPress.cancel();
    this.touchPointerId = null;
    this.moveTween?.kill();
    this.castingTween?.kill();
    this.hoverTween?.kill();
    this.promptReferenceTween?.kill();
    this.container.destroy({ children: true });
  }

  private applyHover(): void {
    this.hoverTween?.kill();
    const s = this.hovered ? HOVER_SCALE : 1;
    this.hoverTween = gsap.to(this.container.scale, {
      x: s,
      y: s,
      duration: 0.16,
      ease: "power2.out",
    });
  }

  private cardRadius(): number {
    return this.face.usesHandRulesView
      ? rulesCardRadius(this.width, this.height)
      : CARD_RADIUS * this.faceScale;
  }

  private redraw(): void {
    const r = this.cardRadius();
    const hw = this.width / 2;
    const hh = this.height / 2;
    this.glow.clear();
    this.ring.clear();
    this.castingTween?.kill();
    this.castingTween = null;

    const seat = this.spec.seatColor ? hexToNum(this.spec.seatColor) : null;
    if (seat !== null) {
      this.glow
        .roundRect(
          -hw - GLOW_PAD,
          -hh - GLOW_PAD,
          this.width + GLOW_PAD * 2,
          this.height + GLOW_PAD * 2,
          r + GLOW_PAD,
        )
        .fill({ color: seat, alpha: 0.28 });
      this.ring
        .roundRect(-hw, -hh, this.width, this.height, r)
        .stroke({ color: seat, width: 2, alpha: 0.7 });
    }

    if (this.spec.isValidTarget) {
      const ring = hexToNum(this.theme.gameTheme.cardRing);
      this.ring
        .roundRect(-hw, -hh, this.width, this.height, r)
        .stroke({ color: ring, width: 4, alpha: 0.95 });
    } else if (this.spec.isCasting) {
      const c = seat ?? hexToNum(this.theme.gameTheme.pointer.friendly);
      this.ring
        .roundRect(-hw, -hh, this.width, this.height, r)
        .stroke({ color: c, width: 3, alpha: 0.9 });
      this.castingTween = gsap.to(this.ring, {
        alpha: 0.45,
        duration: CASTING_PULSE_MS,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
    } else if (this.spec.isTopOfStack) {
      const c = hexToNum(this.theme.gameTheme.activeAction.active);
      this.ring
        .roundRect(-hw, -hh, this.width, this.height, r)
        .stroke({ color: c, width: 2, alpha: 0.85 });
    }
  }

  private syncControls(): void {
    this.viewControls.setSpec(
      this.hovered
        ? {
            rulesView: this.face.usesHandRulesView,
            horizontal: false,
            alternateFace: this.spec.card.isTransformed,
            showFaceControl: this.spec.card.isDoubleFaced,
            onToggleRules: () => this.onToggleRules(this.spec.id),
            onToggleFace: () => this.onFlip(this.spec.id),
          }
        : null,
      this.width,
      this.face.previewControlArtTop * this.faceScale,
      1,
      1,
    );
    this.viewControls.position.x -= this.width / 2;
    this.viewControls.position.y -= this.height / 2;
  }
}
