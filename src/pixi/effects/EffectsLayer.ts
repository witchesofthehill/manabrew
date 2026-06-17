import { Container, Graphics } from "pixi.js";
import { type OneShot, oneShot, oneShotProgress } from "./animation";
import { easeOutCubic } from "./easing";

interface StompFx {
  x: number;
  y: number;
  color: number;
  fx: OneShot;
  gfx: Graphics;
}

const STOMP_DURATION_MS = 520;
const STOMP_CRACKS = 8;

export class EffectsLayer {
  readonly container = new Container();
  private active: StompFx[] = [];

  constructor() {
    this.container.eventMode = "none";
  }

  spawnStomp(now: number, x: number, y: number, color: number): void {
    const gfx = new Graphics();
    this.container.addChild(gfx);
    this.active.push({ x, y, color, fx: oneShot(now, STOMP_DURATION_MS), gfx });
  }

  tick(now: number): void {
    if (this.active.length === 0) return;
    const survivors: StompFx[] = [];
    for (const s of this.active) {
      const p = oneShotProgress(s.fx, now);
      if (p == null) {
        this.container.removeChild(s.gfx);
        s.gfx.destroy();
        continue;
      }
      drawStomp(s.gfx, s.x, s.y, p, s.color);
      survivors.push(s);
    }
    this.active = survivors;
  }

  destroy(): void {
    for (const s of this.active) s.gfx.destroy();
    this.active = [];
    this.container.destroy({ children: true });
  }
}

function drawStomp(g: Graphics, cx: number, cy: number, p: number, color: number): void {
  g.clear();
  const ease = easeOutCubic(p);
  const fade = 1 - p;

  const rx = 6 + ease * 32;
  g.ellipse(cx, cy, rx, rx * 0.42).stroke({ color, width: 0.5 + 2.5 * fade, alpha: fade * 0.85 });

  const rx2 = 3 + ease * 19;
  g.ellipse(cx, cy, rx2, rx2 * 0.42).stroke({ color, width: 1.5, alpha: fade * 0.5 });

  const len = 9 + ease * 24;
  for (let i = 0; i < STOMP_CRACKS; i++) {
    const a = (i / STOMP_CRACKS) * Math.PI * 2 + i * 0.6;
    g.moveTo(cx, cy).lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len * 0.42);
  }
  g.stroke({ color, width: 1, alpha: fade * 0.5 });
}
