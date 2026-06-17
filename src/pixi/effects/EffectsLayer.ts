/**
 * Pooled transient board effects, GPU-batched via Pixi v8's native
 * `ParticleContainer` (no third-party emitter — `@pixi/particle-emitter` is
 * Pixi v7 only). Currently: the ETB dust burst. Mounted by its owner (the
 * board region, above the felt / below the cards) and ticked from that owner's
 * animate loop. The sim is frame-based (one step per tick).
 */

import { Container, ParticleContainer, Particle, Texture } from "pixi.js";

interface DustParticle {
  p: Particle;
  vx: number;
  vy: number;
  life: number;
  max: number;
  s0: number;
}

let dustTexture: Texture | null = null;

/** A soft radial puff, generated once and tinted per particle. */
function dustTex(): Texture {
  if (dustTexture) return dustTexture;
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  dustTexture = Texture.from(canvas);
  return dustTexture;
}

export class EffectsLayer {
  readonly container = new Container();
  private pc = new ParticleContainer({
    dynamicProperties: { position: true, vertex: true, color: true, rotation: false, uvs: false },
  });
  private dust: DustParticle[] = [];

  constructor() {
    this.container.eventMode = "none";
    this.container.addChild(this.pc);
  }

  /** Kick a flattened ring of dust outward from `(x, y)` (the card's foot). */
  burstDust(x: number, y: number, color: number, count = 18): void {
    const tex = dustTex();
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 2.4;
      const s0 = 0.16 + Math.random() * 0.4;
      const p = new Particle({
        texture: tex,
        x,
        y,
        anchorX: 0.5,
        anchorY: 0.5,
        tint: color,
        alpha: 0.85,
      });
      p.scaleX = s0;
      p.scaleY = s0;
      this.pc.addParticle(p);
      this.dust.push({
        p,
        vx: Math.cos(ang) * speed,
        // Flattened (×0.45) so it reads as spreading along the ground, with a
        // small upward puff that gravity then pulls back down.
        vy: Math.sin(ang) * speed * 0.45 - 0.7,
        life: 0,
        max: 24 + Math.random() * 16,
        s0,
      });
    }
  }

  tick(): void {
    if (this.dust.length === 0) return;
    const survivors: DustParticle[] = [];
    for (const d of this.dust) {
      d.life += 1;
      d.vy += 0.05;
      d.vx *= 0.9;
      d.vy *= 0.9;
      d.p.x += d.vx;
      d.p.y += d.vy;
      const t = d.life / d.max;
      d.p.alpha = (1 - t) * 0.85;
      const s = d.s0 * (1 + t * 1.8);
      d.p.scaleX = s;
      d.p.scaleY = s;
      if (d.life >= d.max) {
        this.pc.removeParticle(d.p);
        continue;
      }
      survivors.push(d);
    }
    this.dust = survivors;
    this.pc.update();
  }

  destroy(): void {
    this.dust = [];
    this.container.destroy({ children: true });
  }
}
