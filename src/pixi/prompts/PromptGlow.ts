import { BlurFilter, Container, Graphics, GraphicsPath } from "pixi.js";
import { animationsEnabled } from "@/pixi/effects/enabled";
import { gsap } from "@/pixi/effects/gsap";

const ORBIT_MS = 8000;
const BREATH_MS = 3600;

interface GlowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PromptGlowAttachment {
  base: GlowRect | null;
  tower: GlowRect;
  radius: number;
}

export interface PromptPanelShape {
  width: number;
  height: number;
  radius: number;
  squareBottom: boolean;
}

function attachmentPath(a: PromptGlowAttachment): string {
  const r = a.radius;
  const t = a.tower;
  const tx0 = t.x;
  const tx1 = t.x + t.width;
  const column = (x0: number, x1: number, top: number) =>
    `H ${x0} V ${top + r} Q ${x0},${top} ${x0 + r},${top} H ${x1 - r} Q ${x1},${top} ${x1},${top + r} V 0`;
  const base = a.base;
  if (!base) return column(tx0, tx1, t.y);
  const bx0 = base.x;
  const bx1 = base.x + base.width;
  const rb = Math.min(r, base.height);
  const stepLeft = tx0 - bx0 > rb;
  const stepRight = bx1 - tx1 > rb;
  if (!stepLeft && !stepRight) return column(bx0, bx1, t.y);
  const left = stepLeft
    ? `H ${bx0} V ${base.y + rb} Q ${bx0},${base.y} ${bx0 + rb},${base.y} H ${tx0}`
    : `H ${bx0}`;
  const towerX0 = stepLeft ? tx0 : bx0;
  const towerX1 = stepRight ? tx1 : bx1;
  const right = stepRight
    ? `V ${base.y} H ${bx1 - rb} Q ${bx1},${base.y} ${bx1},${base.y + rb} V 0`
    : "V 0";
  return `${left} V ${t.y + r} Q ${towerX0},${t.y} ${towerX0 + r},${t.y}
    H ${towerX1 - r} Q ${towerX1},${t.y} ${towerX1},${t.y + r} ${right}`;
}

export function promptPanelOutline(
  shape: PromptPanelShape,
  attachments: PromptGlowAttachment[],
): string {
  const { width, height, radius, squareBottom } = shape;
  const bottom = squareBottom ? 0 : radius;
  const sorted = [...attachments].sort((a, b) => a.tower.x - b.tower.x);
  const flushLeft = !!sorted[0] && sorted[0].tower.x <= 0;
  const top = sorted.map(attachmentPath).join(" ");
  return `M ${flushLeft ? 0 : radius},0 ${top} H ${width - radius} Q ${width},0 ${width},${radius}
    V ${height - bottom} Q ${width},${height} ${width - bottom},${height}
    H ${bottom} Q 0,${height} 0,${height - bottom}
    ${flushLeft ? "V 0" : `V ${radius} Q 0,0 ${radius},0`} Z`;
}

interface PromptGlowOptions extends PromptPanelShape {
  color: number;
  highlight: number;
}

export class PromptGlow extends Container {
  readonly spill = new Graphics();
  private readonly spillMask = new Graphics();
  private readonly halo = new Graphics();
  private readonly edge = new Graphics();
  private readonly flare = new Graphics();
  private readonly glint = new Graphics();
  private orbit: gsap.core.Tween | null = null;
  private attachments: PromptGlowAttachment[] = [];
  private elapsed = 0;
  private emphasis = 0;
  private readonly options: PromptGlowOptions;

  constructor(options: PromptGlowOptions) {
    super();
    this.options = options;
    this.eventMode = "none";
    this.spill.eventMode = "none";
    this.spill.filters = [new BlurFilter({ strength: 14 })];
    this.addChild(this.spillMask, this.halo, this.edge, this.flare, this.glint);
    this.draw();
  }

  setAttachments(attachments: PromptGlowAttachment[]): void {
    this.attachments = attachments;
    this.draw();
  }

  private draw(): void {
    const { color, highlight } = this.options;
    this.glint
      .clear()
      .ellipse(-8, 0, 14, 3.5)
      .fill({ color, alpha: 0.25 })
      .ellipse(-5, 0, 9, 1.5)
      .fill({ color: highlight, alpha: 0.45 })
      .circle(0, 0, 2.2)
      .fill({ color: highlight, alpha: 0.95 });
    const outline = promptPanelOutline(this.options, this.attachments);
    const path = new GraphicsPath(outline);
    this.spill
      .clear()
      .path(new GraphicsPath(promptPanelOutline(this.options, [])))
      .stroke({ color, width: 20 });
    this.halo
      .clear()
      .path(path)
      .stroke({ color, width: 6, alpha: 0.12 })
      .path(path)
      .stroke({ color, width: 3, alpha: 0.32 });
    this.edge.clear().path(path).stroke({ color, width: 1 });
    this.flare.clear().path(path).stroke({ color: highlight, width: 1.5 });

    this.spillMask.clear();
    if (this.attachments.length > 0) {
      for (const { base, tower, radius: r } of this.attachments) {
        if (base) this.spillMask.roundRect(base.x, base.y, base.width, base.height + r, r);
        this.spillMask.roundRect(tower.x, tower.y, tower.width, tower.height + r, r);
      }
      this.spillMask.fill({ color });
      if (this.spill.mask !== this.spillMask) {
        this.spill.setMask({ mask: this.spillMask, inverse: true });
      }
    } else {
      this.spill.mask = null;
    }

    this.orbit?.kill();
    this.orbit = gsap.to(this.glint, {
      motionPath: { path: outline, autoRotate: true, useRadians: true },
      duration: ORBIT_MS / 1000,
      ease: "none",
      paused: true,
    });
    this.update(this.elapsed, this.emphasis);
  }

  update(elapsed: number, emphasis = 0): void {
    this.elapsed = elapsed;
    this.emphasis = emphasis;
    const animated = animationsEnabled();
    if (!animated) emphasis = 0;
    const breath = animated ? (1 - Math.cos((elapsed / BREATH_MS) * Math.PI * 2)) / 2 : 0;
    this.spill.alpha = 0.1 + breath * 0.12 + emphasis * 0.15;
    this.halo.alpha = 0.4 + breath * 0.15 + emphasis * 0.8;
    this.edge.alpha = 0.55 + breath * 0.2 + emphasis * 0.25;
    this.flare.alpha = emphasis * 0.85;
    this.glint.visible = animated;
    if (animated) this.orbit?.progress((elapsed % ORBIT_MS) / ORBIT_MS);
  }

  override destroy(): void {
    this.orbit?.kill();
    super.destroy({ children: true });
  }
}
