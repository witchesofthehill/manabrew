/**
 * Pooled transient board effects, GPU-batched via Pixi v8's native
 * `ParticleContainer` (no third-party emitter — `@pixi/particle-emitter` is
 * Pixi v7 only). Currently the ETB stomp: a billowing dust cloud + radial
 * ground cracks. Mounted by its owner (the board region, above the felt /
 * below the cards) and ticked from that owner's animate loop. The sim is
 * frame-based (one step per tick).
 */

import { Container, Graphics, ParticleContainer, Particle, Texture } from "pixi.js";

interface DustParticle {
  p: Particle;
  vx: number;
  vy: number;
  life: number;
  max: number;
  s0: number;
}

interface Crackle {
  gfx: Graphics;
  life: number;
  max: number;
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
  private crackles: Crackle[] = [];

  constructor() {
    this.container.eventMode = "none";
    this.container.addChild(this.pc);
  }

  /** The full ground reaction of a creature landing: radial cracks snap in
   *  (under the dust) and a billowing dust cloud rises from the foot. */
  stompGround(x: number, y: number, dustColor: number, crackColor: number): void {
    this.spawnCracks(x, y, crackColor);
    this.burstDust(x, y, dustColor);
  }

  private burstDust(x: number, y: number, color: number, count = 34): void {
    const tex = dustTex();
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = 0.4 + Math.random() * 2.6; // wide range → some hang as a cloud
      const s0 = 0.2 + Math.random() * 0.55;
      const p = new Particle({
        texture: tex,
        x,
        y,
        anchorX: 0.5,
        anchorY: 0.5,
        tint: color,
        alpha: 0.7,
      });
      p.scaleX = s0;
      p.scaleY = s0;
      this.pc.addParticle(p);
      this.dust.push({
        p,
        vx: Math.cos(ang) * speed,
        // Flattened spread + an upward billow that low gravity lets hang.
        vy: Math.sin(ang) * speed * 0.55 - (0.4 + Math.random() * 0.9),
        life: 0,
        max: 50 + Math.random() * 40,
        s0,
      });
    }
  }

  /** Jagged radial cracks, flattened into ground perspective, drawn once and
   *  faded over their life. Placed under the dust. */
  private spawnCracks(x: number, y: number, color: number): void {
    const g = new Graphics();
    const arms = 6 + Math.floor(Math.random() * 3);
    for (let i = 0; i < arms; i++) {
      const base = (i / arms) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const len = 14 + Math.random() * 24;
      const segs = 3;
      g.moveTo(x, y);
      for (let s = 1; s <= segs; s++) {
        const a = base + (Math.random() - 0.5) * 0.5;
        const r = (len / segs) * s;
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.5);
      }
    }
    g.stroke({ color, width: 1.5, alpha: 0.85 });
    g.ellipse(x, y, 5, 2.5).fill({ color, alpha: 0.4 });
    this.container.addChildAt(g, 0); // under the dust particle container
    this.crackles.push({ gfx: g, life: 0, max: 60 });
  }

  tick(): void {
    if (this.dust.length > 0) {
      const survivors: DustParticle[] = [];
      for (const d of this.dust) {
        d.life += 1;
        d.vy += 0.025; // low gravity → the cloud lingers
        d.vx *= 0.9;
        d.vy *= 0.92;
        d.p.x += d.vx;
        d.p.y += d.vy;
        const t = d.life / d.max;
        d.p.alpha = (1 - t) * 0.7;
        const s = d.s0 * (1 + t * 2.8); // billow outward as it dissipates
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

    if (this.crackles.length > 0) {
      const survivors: Crackle[] = [];
      for (const c of this.crackles) {
        c.life += 1;
        const t = c.life / c.max;
        // Snap in (held), then fade.
        c.gfx.alpha = t < 0.15 ? 1 : Math.max(0, 1 - (t - 0.15) / 0.85);
        if (c.life >= c.max) {
          this.container.removeChild(c.gfx);
          c.gfx.destroy();
          continue;
        }
        survivors.push(c);
      }
      this.crackles = survivors;
    }
  }

  destroy(): void {
    this.dust = [];
    for (const c of this.crackles) c.gfx.destroy();
    this.crackles = [];
    this.container.destroy({ children: true });
  }
}
