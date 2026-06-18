import { Container, Graphics, ParticleContainer, Particle, Texture } from "pixi.js";
import { CRACKLE, DUST, FLASH, SHOCKWAVE } from "./config";
import { easeOutCubic } from "./easing";

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

interface Decal {
  gfx: Graphics;
  life: number;
  max: number;
  draw: (g: Graphics, t: number) => void;
}

let dustTexture: Texture | null = null;

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
  private decals: Decal[] = [];

  constructor() {
    this.container.eventMode = "none";
    this.container.addChild(this.pc);
  }

  stompGround(x: number, y: number): void {
    this.spawnShockwave(x, y);
    this.spawnCracks(x, y);
    this.burstDust(x, y);
    this.spawnFlash(x, y);
  }

  private spawnFlash(x: number, y: number): void {
    const g = new Graphics();
    this.container.addChild(g);
    this.decals.push({
      gfx: g,
      life: 0,
      max: FLASH.lifeFrames,
      draw: (gg, t) => {
        const r = FLASH.startRadius + (FLASH.endRadius - FLASH.startRadius) * easeOutCubic(t);
        gg.clear();
        gg.ellipse(x, y, r, r * FLASH.flatten).fill({
          color: FLASH.color,
          alpha: (1 - t) * FLASH.alpha,
        });
      },
    });
  }

  private spawnShockwave(x: number, y: number): void {
    const g = new Graphics();
    this.container.addChildAt(g, 0);
    this.decals.push({
      gfx: g,
      life: 0,
      max: SHOCKWAVE.lifeFrames,
      draw: (gg, t) => {
        const r =
          SHOCKWAVE.startRadius + (SHOCKWAVE.endRadius - SHOCKWAVE.startRadius) * easeOutCubic(t);
        gg.clear();
        gg.ellipse(x, y, r, r * SHOCKWAVE.flatten).stroke({
          color: SHOCKWAVE.color,
          width: SHOCKWAVE.strokeWidth * (1 - t),
          alpha: (1 - t) * SHOCKWAVE.alpha,
        });
      },
    });
  }

  private burstDust(x: number, y: number, count = DUST.count): void {
    const tex = dustTex();
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const speed = DUST.speedMin + Math.random() * DUST.speedExtra;
      const s0 = DUST.scaleMin + Math.random() * DUST.scaleExtra;
      const p = new Particle({
        texture: tex,
        x,
        y,
        anchorX: 0.5,
        anchorY: 0.5,
        tint: DUST.color,
        alpha: DUST.alpha,
      });
      p.scaleX = s0;
      p.scaleY = s0;
      this.pc.addParticle(p);
      this.dust.push({
        p,
        vx: Math.cos(ang) * speed,
        vy:
          Math.sin(ang) * speed * DUST.flatten -
          (DUST.upwardMin + Math.random() * DUST.upwardExtra),
        life: 0,
        max: DUST.lifeMin + Math.random() * DUST.lifeExtra,
        s0,
      });
    }
  }

  private spawnCracks(x: number, y: number): void {
    const g = new Graphics();
    const arms = CRACKLE.armsMin + Math.floor(Math.random() * CRACKLE.armsExtra);
    for (let i = 0; i < arms; i++) {
      const base = (i / arms) * Math.PI * 2 + (Math.random() - 0.5) * CRACKLE.baseJitter;
      const len = CRACKLE.lengthMin + Math.random() * CRACKLE.lengthExtra;
      const segs = CRACKLE.segments;
      g.moveTo(x, y);
      for (let s = 1; s <= segs; s++) {
        const a = base + (Math.random() - 0.5) * CRACKLE.segmentJitter;
        const r = (len / segs) * s;
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * CRACKLE.flatten);
      }
    }
    g.stroke({ color: CRACKLE.color, width: CRACKLE.strokeWidth, alpha: CRACKLE.strokeAlpha });
    g.ellipse(x, y, CRACKLE.blotchRadiusX, CRACKLE.blotchRadiusY).fill({
      color: CRACKLE.color,
      alpha: CRACKLE.blotchAlpha,
    });
    this.container.addChildAt(g, 0);
    this.crackles.push({ gfx: g, life: 0, max: CRACKLE.lifeFrames });
  }

  tick(): void {
    if (this.dust.length > 0) {
      const survivors: DustParticle[] = [];
      for (const d of this.dust) {
        d.life += 1;
        d.vy += DUST.gravity;
        d.vx *= DUST.dragX;
        d.vy *= DUST.dragY;
        d.p.x += d.vx;
        d.p.y += d.vy;
        const t = d.life / d.max;
        d.p.alpha = (1 - t) * DUST.alpha;
        const s = d.s0 * (1 + t * DUST.growth);
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
        const hold = CRACKLE.holdFraction;
        c.gfx.alpha = t < hold ? 1 : Math.max(0, 1 - (t - hold) / (1 - hold));
        if (c.life >= c.max) {
          this.container.removeChild(c.gfx);
          c.gfx.destroy();
          continue;
        }
        survivors.push(c);
      }
      this.crackles = survivors;
    }

    if (this.decals.length > 0) {
      const survivors: Decal[] = [];
      for (const d of this.decals) {
        d.life += 1;
        if (d.life >= d.max) {
          this.container.removeChild(d.gfx);
          d.gfx.destroy();
          continue;
        }
        d.draw(d.gfx, d.life / d.max);
        survivors.push(d);
      }
      this.decals = survivors;
    }
  }

  destroy(): void {
    this.dust = [];
    for (const c of this.crackles) c.gfx.destroy();
    this.crackles = [];
    for (const d of this.decals) d.gfx.destroy();
    this.decals = [];
    this.container.destroy({ children: true });
  }
}
