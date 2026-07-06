import { Container, Graphics, type FederatedPointerEvent } from "pixi.js";
import gsap from "gsap";
import { CARD_W, CARD_H } from "@/components/game/game.constants";
import type { Theme } from "@/hooks/useTheme";
import { CardSprite } from "../CardSprite";
import { hexToNum } from "../colorUtils";
import { LongPressGesture } from "../LongPressGesture";
import type { StackCardSpec } from "./stack.types";

const ENTER_MS = 0.42;
const FLASH_MS = 0.56;
const MOVE_MS = 0.56;
const MOVE_EASE = "cubic-bezier(0.23,0.63,0.32,1)";
const CASTING_PULSE_MS = 1;
export const HOVER_SCALE = 1.12;
const HOVER_LIFT_PX = 2;
const RING_RADIUS_FRAC = 0.05;
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
  private ring = new Graphics();
  private face: CardSprite;
  private hovered = false;
  private entered = false;
  private lastTargetKey = "";
  private moveTween: gsap.core.Tween | null = null;
  private castingTween: gsap.core.Tween | null = null;
  private hoverTween: gsap.core.Tween | null = null;
  private longPress = new LongPressGesture();

  constructor(
    theme: Theme,
    spec: StackCardSpec,
    cardWidth: number,
    onOpen: () => void,
    onTarget: (id: string) => void,
    onHover: (id: string | null) => void,
  ) {
    this.theme = theme;
    this.spec = spec;
    this.sourceId = spec.sourceId;
    this.faceScale = cardWidth / CARD_W;

    this.container = new Container();
    this.glow.eventMode = "none";
    this.ring.eventMode = "none";
    this.face = new CardSprite(spec.card, "hand");
    this.face.scale.set(this.faceScale);
    this.face.position.set(0, 0);

    const horiz = this.face.horizontalFrame;
    this.width = (horiz ? CARD_H : CARD_W) * this.faceScale;
    this.height = (horiz ? CARD_W : CARD_H) * this.faceScale;

    const hit = new Graphics()
      .roundRect(
        -this.width / 2,
        -this.height / 2,
        this.width,
        this.height,
        this.width * RING_RADIUS_FRAC,
      )
      .fill({ color: 0xffffff, alpha: 0.001 });
    hit.eventMode = "static";
    hit.cursor = "pointer";
    hit.on("pointertap", () => {
      if (this.longPress.consumeTap(this.spec.id)) return;
      if (this.spec.isValidTarget) onTarget(this.spec.id);
      else onOpen();
    });
    hit.on("pointerdown", (e: FederatedPointerEvent) => {
      this.longPress.start(e, this.spec.id, () => {
        this.hovered = true;
        this.applyHover();
        onHover(this.spec.id);
      });
    });
    hit.on("globalpointermove", (e: FederatedPointerEvent) =>
      this.longPress.move(e.global.x, e.global.y),
    );
    const endTouch = () => {
      this.longPress.cancel();
      this.longPress.releaseFired();
    };
    hit.on("pointerup", endTouch);
    hit.on("pointerupoutside", endTouch);
    hit.on("pointerover", (e: FederatedPointerEvent) => {
      if (e.pointerType === "touch") return;
      this.hovered = true;
      this.applyHover();
      onHover(this.spec.id);
    });
    hit.on("pointerout", () => {
      this.hovered = false;
      this.applyHover();
      onHover(null);
    });

    this.container.addChild(this.glow, this.face, this.ring, hit);
    this.redraw();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.redraw();
  }

  setSpec(spec: StackCardSpec): void {
    const ringChanged =
      spec.seatColor !== this.spec.seatColor ||
      spec.isCasting !== this.spec.isCasting ||
      spec.isTopOfStack !== this.spec.isTopOfStack ||
      spec.isValidTarget !== this.spec.isValidTarget;
    const dimChanged = spec.isDimmed !== this.spec.isDimmed;
    this.spec = spec;
    if (dimChanged) this.container.alpha = spec.isDimmed ? 0.6 : 1;
    if (ringChanged) this.redraw();
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

  destroy(): void {
    this.longPress.cancel();
    this.moveTween?.kill();
    this.castingTween?.kill();
    this.hoverTween?.kill();
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

  private redraw(): void {
    const r = this.width * RING_RADIUS_FRAC;
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
          r,
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
}
