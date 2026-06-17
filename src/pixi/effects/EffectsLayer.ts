/**
 * Pooled transient board effects, GPU-batched via Pixi v8's native
 * `ParticleContainer` (no third-party emitter — `@pixi/particle-emitter` is
 * Pixi v7 only). The ETB stomp's ground reaction: one crisp impact ring (the
 * signature) with a quiet low dust skirt for texture. Mounted by its owner
 * (the board region, above the felt / below the cards) and ticked from that
 * owner's animate loop. The sim is frame-based (one step per tick).
 */

import { Container, Graphics, ParticleContainer, Particle, Texture } from "pixi.js";
import { easeOutCubic } from "./easing";

interface DustParticle {
  p: Particle;
  vx: number;
  vy: number;
  life: number;
  max: number;
  s0: number;
}

interface Ring {
  gfx: Graphics;
  x: number;
  y: number;
  life: number;
  max: number;
}

// Warm sand, a fixed aesthetic across themes (like the foil gold) — not theme
// tokens. The ring is the bright "impact"; dust is pale + translucent.
const RING_COLOR = 0xe8d6a6;
const DUST_COLOR = 0xd9c8a0;

const RING_MAX = 22; // frames (~0.36s)

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
  grad.addColorStop(0.5, "rgba(255,255,255,0.5)");
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
  private rings: Ring[] = [];

  constructor() {
    this.container.eventMode = "none";
    this.container.addChild(this.pc);
  }

  /** The ground reaction of a creature landing: one impact ring snaps outward
   *  (under the dust) and a low dust skirt puffs from the foot. */
  stompGround(x: number, y: number): void {
    this.spawnRing(x, y);
    this.burstDust(x, y);
  }

  /** A small, low, fast dust skirt — texture for the impact, deliberately not a
   *  billowing cloud (the ring is the signature). */
  private burstDust(x: number, y: number, count = 12): void {
    const tex = dustTex();
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 0.5 + Math.random() * 1.6;
      const s0 = 0.14 + Math.random() * 0.34;
      const p = new Particle({
        texture: tex,
        x,
        y,
        anchorX: 0.5,
        anchorY: 0.5,
        tint: DUST_COLOR,
        alpha: 0.4,
      });
      p.scaleX = s0;
      p.scaleY = s0;
      this.pc.addParticle(p);
      this.dust.push({
        p,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed * 0.5 - (0.2 + Math.random() * 0.5),
        life: 0,
        max: 22 + Math.random() * 18,
        s0,
      });
    }
  }

  /** The signature: one flattened ring expanding fast from the foot, thinning
   *  and fading. Redrawn each tick (it animates). */
  private spawnRing(x: number, y: number): void {
    const gfx = new Graphics();
    this.container.addChildAt(gfx, 0); // under the dust particle container
    this.rings.push({ gfx, x, y, life: 0, max: RING_MAX });
  }

  tick(): void {
    if (this.rings.length > 0) {
      const survivors: Ring[] = [];
      for (const r of this.rings) {
        r.life += 1;
        const t = r.life / r.max;
        if (t >= 1) {
          this.container.removeChild(r.gfx);
          r.gfx.destroy();
          continue;
        }
        const e = easeOutCubic(t);
        const radius = 5 + e * 30;
        r.gfx.clear();
        r.gfx
          .ellipse(r.x, r.y, radius, radius * 0.42)
          .stroke({ color: RING_COLOR, width: 0.5 + 2.5 * (1 - t), alpha: (1 - t) * 0.9 });
        survivors.push(r);
      }
      this.rings = survivors;
    }

    if (this.dust.length > 0) {
      const survivors: DustParticle[] = [];
      for (const d of this.dust) {
        d.life += 1;
        d.vy += 0.04;
        d.vx *= 0.9;
        d.vy *= 0.9;
        d.p.x += d.vx;
        d.p.y += d.vy;
        const t = d.life / d.max;
        d.p.alpha = (1 - t) * 0.4;
        const s = d.s0 * (1 + t * 2);
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
  }

  destroy(): void {
    this.dust = [];
    for (const r of this.rings) r.gfx.destroy();
    this.rings = [];
    this.container.destroy({ children: true });
  }
}
