import { Container, FillGradient, Graphics } from "pixi.js";
import { getTheme } from "@/hooks/useTheme";
import { withAlpha } from "@/themes/gameTheme";
import { hexToNum } from "@/pixi/colorUtils";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";

const SPARK_COUNT = 36;
const SPARK_STEP = 12;
type DragPhase = "hover" | "armed" | "drag";

export class LimitedBoosterDragEffects {
  readonly root = new Container({ label: "booster-drag-effects", eventMode: "none" });
  private readonly cursor = new Container();
  private readonly halo = new Graphics();
  private readonly ring = new Graphics();
  private readonly streak = new Graphics();
  private readonly sparks = Array.from({ length: SPARK_COUNT }, () => new Graphics());
  private readonly request: () => void;
  private phase: DragPhase | null = null;
  private index = 0;
  private x = 0;
  private y = 0;
  private color = 0;
  private highlight = 0;
  private animated: boolean | null = null;

  constructor(request: () => void) {
    this.request = request;
    this.cursor.addChild(this.halo, this.ring);
    this.root.addChild(this.streak, ...this.sparks, this.cursor);
    this.cursor.visible = false;
    for (const spark of this.sparks) spark.visible = false;
    this.setTheme();
  }

  setTheme(): void {
    const { appTheme, gameTheme } = getTheme();
    this.color = hexToNum(gameTheme.cardRing);
    this.highlight = hexToNum(appTheme.foreground);
    const glow = new FillGradient({
      type: "radial",
      center: { x: 0.5, y: 0.5 },
      innerRadius: 0,
      outerCenter: { x: 0.5, y: 0.5 },
      outerRadius: 0.5,
      textureSpace: "local",
      colorStops: [
        { offset: 0, color: withAlpha(gameTheme.cardRing, 0.55) },
        { offset: 0.4, color: withAlpha(gameTheme.cardRing, 0.2) },
        { offset: 1, color: withAlpha(gameTheme.cardRing, 0) },
      ],
    });
    this.halo.clear().circle(0, 0, 30).fill(glow);
    this.ring
      .clear()
      .circle(0, 0, 13)
      .stroke({ color: this.color, alpha: 0.75, width: 1.4 })
      .star(0, 0, 4, 6, 1.5)
      .fill({ color: this.highlight });
    for (let index = 0; index < this.sparks.length; index++) {
      const color = index % 3 === 0 ? hexToNum(gameTheme.targeting.friendly) : this.color;
      this.sparks[index]
        .clear()
        .circle(0, 0, 7)
        .fill({ color, alpha: 0.1 })
        .star(0, 0, 4, index % 2 ? 3 : 5, 1)
        .fill({ color: index % 3 === 2 ? this.highlight : color });
    }
  }

  update(x: number, y: number, phase: DragPhase): void {
    const animated = animationsEnabled();
    this.frame();
    const dx = x - this.x;
    const dy = y - this.y;
    const distance = Math.hypot(dx, dy);
    const wasDragging = this.phase === "armed" || this.phase === "drag";
    if (phase !== this.phase) {
      this.phase = phase;
      gsap.killTweensOf(this.halo.scale);
      this.halo.scale.set(1);
      if (animated && phase === "armed")
        gsap.to(this.halo.scale, {
          x: 1.15,
          y: 1.15,
          duration: 0.45,
          repeat: -1,
          yoyo: true,
          ease: "sine.inOut",
          onUpdate: this.request,
        });
    }
    gsap.killTweensOf(this.cursor);
    gsap.killTweensOf(this.cursor.scale);
    this.cursor.position.set(x, y);
    this.cursor.scale.set(1);
    this.cursor.alpha = 1;
    this.cursor.visible = phase !== "hover";
    this.streak.clear();
    if (animated && phase === "drag" && wasDragging && distance > 0) {
      const length = Math.min(distance, 38);
      const tailX = x - (dx / distance) * length;
      const tailY = y - (dy / distance) * length;
      this.streak
        .moveTo(tailX, tailY)
        .lineTo(x, y)
        .stroke({ color: this.color, width: 8, alpha: 0.16, cap: "round" })
        .moveTo(tailX, tailY)
        .lineTo(x, y)
        .stroke({ color: this.highlight, width: 1.4, alpha: 0.7, cap: "round" });
      const count = Math.min(6, Math.ceil(distance / SPARK_STEP));
      for (let index = 0; index < count; index++)
        this.emit(x - (dx * index) / count, y - (dy * index) / count, 26);
    }
    this.x = x;
    this.y = y;
    this.request();
  }

  private emit(x: number, y: number, radius: number): void {
    const index = this.index++;
    const spark = this.sparks[index % SPARK_COUNT];
    const angle = index * 2.399;
    gsap.killTweensOf(spark);
    spark.position.set(x, y);
    spark.scale.set(0.65 + (index % 4) * 0.15);
    spark.rotation = angle;
    spark.alpha = 0.9;
    spark.visible = true;
    gsap.to(spark, {
      x: x + Math.cos(angle) * radius,
      y: y + Math.sin(angle) * radius - 12,
      alpha: 0,
      rotation: angle + 0.7,
      duration: 0.5,
      ease: "power2.out",
      onUpdate: this.request,
      onComplete: () => {
        spark.visible = false;
      },
    });
  }

  stop(confirm = false): void {
    if (this.phase === null && !confirm) return;
    this.phase = null;
    gsap.killTweensOf(this.halo.scale);
    this.streak.clear();
    if (confirm && animationsEnabled()) {
      for (let index = 0; index < 12; index++) this.emit(this.x, this.y, 58);
      gsap.to(this.cursor, { alpha: 0, duration: 0.25, onUpdate: this.request });
      gsap.to(this.cursor.scale, { x: 1.6, y: 1.6, duration: 0.25, ease: "power2.out" });
    } else {
      this.cursor.visible = false;
      for (const spark of this.sparks) {
        gsap.killTweensOf(spark);
        spark.visible = false;
      }
    }
    this.request();
  }

  frame(): void {
    const animated = animationsEnabled();
    if (this.animated === animated) return;
    this.animated = animated;
    if (animated) return;
    this.cursor.visible = this.phase === "armed" || this.phase === "drag";
    this.cursor.alpha = 1;
    this.streak.clear();
    gsap.killTweensOf(this.halo.scale);
    gsap.killTweensOf(this.cursor);
    gsap.killTweensOf(this.cursor.scale);
    this.cursor.scale.set(1);
    this.halo.scale.set(1);
    for (const spark of this.sparks) {
      gsap.killTweensOf(spark);
      spark.visible = false;
    }
  }

  destroy(): void {
    gsap.killTweensOf(this.halo.scale);
    gsap.killTweensOf(this.cursor);
    gsap.killTweensOf(this.cursor.scale);
    for (const spark of this.sparks) gsap.killTweensOf(spark);
    this.root.destroy({ children: true });
  }
}
