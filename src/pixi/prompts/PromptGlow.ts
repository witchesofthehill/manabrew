import { Container, Graphics, GraphicsPath } from "pixi.js";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";

const ORBIT_MS = 8000;
const BREATH_MS = 3600;

export class PromptGlow extends Container {
  private readonly halo: Graphics;
  private readonly edge: Graphics;
  private readonly flare: Graphics;
  private readonly glint = new Graphics();
  private readonly orbit: gsap.core.Tween;

  constructor(options: {
    width: number;
    height: number;
    radius: number;
    squareBottom: boolean;
    color: number;
    highlight: number;
  }) {
    super();
    this.eventMode = "none";
    const { width, height, radius, squareBottom, color, highlight } = options;
    const bottom = squareBottom ? 0 : radius;
    const outline = `M ${radius},0 H ${width - radius} Q ${width},0 ${width},${radius}
      V ${height - bottom} Q ${width},${height} ${width - bottom},${height}
      H ${bottom} Q 0,${height} 0,${height - bottom}
      V ${radius} Q 0,0 ${radius},0 Z`;
    const path = new GraphicsPath(outline);
    this.halo = new Graphics()
      .path(path)
      .stroke({ color, width: 6, alpha: 0.12 })
      .path(path)
      .stroke({ color, width: 3, alpha: 0.32 });
    this.edge = new Graphics().path(path).stroke({ color, width: 1 });
    this.flare = new Graphics().path(path).stroke({ color: highlight, width: 1.5 });
    this.glint
      .ellipse(-6, 0, 10, 2)
      .fill({ color, alpha: 0.12 })
      .ellipse(-3, 0, 6, 1)
      .fill({ color, alpha: 0.4 })
      .circle(0, 0, 1.3)
      .fill({ color: highlight, alpha: 0.9 });
    this.addChild(this.halo, this.edge, this.flare, this.glint);
    this.orbit = gsap.to(this.glint, {
      motionPath: { path: outline, autoRotate: true, useRadians: true },
      duration: ORBIT_MS / 1000,
      ease: "none",
      paused: true,
    });
    this.update(0);
  }

  update(elapsed: number, emphasis = 0): void {
    const animated = animationsEnabled();
    if (!animated) emphasis = 0;
    const breath = animated ? (1 - Math.cos((elapsed / BREATH_MS) * Math.PI * 2)) / 2 : 0;
    this.halo.alpha = 0.4 + breath * 0.15 + emphasis * 0.8;
    this.edge.alpha = 0.55 + breath * 0.2 + emphasis * 0.25;
    this.flare.alpha = emphasis * 0.85;
    this.glint.visible = animated;
    if (animated) this.orbit.progress((elapsed % ORBIT_MS) / ORBIT_MS);
  }

  override destroy(): void {
    this.orbit.kill();
    super.destroy({ children: true });
  }
}
