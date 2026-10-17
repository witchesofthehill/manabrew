import { Container, FillGradient, Graphics } from "pixi.js";
import type { Theme } from "@/hooks/useTheme";
import { withAlpha } from "@/themes/gameTheme";
import { hexToNum } from "@/pixi/colorUtils";
import { gsap } from "@/pixi/effects/gsap";

const DIVIDER = {
  shadowAlpha: 0.62,
  baseFadeWidthPx: 14,
  collapseFadeWidthPx: 38,
  barWidthPx: 2,
  auraAlpha: 0.16,
  auraWidthRatio: 0.62,
} as const;

const VOID_AURA = {
  idleAlpha: 0.78,
  minAlpha: 0.68,
  maxAlpha: 0.88,
  durationSeconds: 5.2,
} as const;

const FOG_PARTICLE_ALPHA = {
  idle: 0.22,
  min: 0.16,
  max: 0.34,
} as const;

const FOG_PARTICLE_COUNT = 7;

interface FogParticleSpec {
  x: number;
  y: number;
  radius: number;
  driftX: number;
  driftY: number;
  duration: number;
  delay: number;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomFogParticleSpec(index: number): FogParticleSpec {
  const duration = randomBetween(5.4, 8.2);
  return {
    x: randomBetween(-14, 14),
    y: (index + randomBetween(0.3, 0.7)) / FOG_PARTICLE_COUNT,
    radius: randomBetween(0.9, 1.8),
    driftX: randomBetween(-5, 5),
    driftY: randomBetween(7, 13),
    duration,
    delay: -Math.random() * duration,
  };
}

interface FogParticle {
  anchor: Container;
  dot: Graphics;
  spec: FogParticleSpec;
  animated: boolean | null;
}

interface FogParticleGroup {
  container: Container;
  particles: FogParticle[];
}

export class BattlefieldDividers {
  readonly root = new Container();
  private readonly fogGfx = new Graphics();
  private readonly fogAuraGfx = new Graphics();
  private readonly fogParticleLayer = new Container();
  private fogGradRight: FillGradient | null = null;
  private fogGradLeft: FillGradient | null = null;
  private fogAuraGradRight: FillGradient | null = null;
  private fogAuraGradLeft: FillGradient | null = null;
  private fogAnimationEnabled: boolean | null = null;
  private fogParticleGroups: FogParticleGroup[] = [];
  private theme: Theme;
  private readonly request: () => void;
  constructor(theme: Theme, request: () => void) {
    this.theme = theme;
    this.request = request;
    this.root.eventMode = "none";
    this.fogAuraGfx.blendMode = "screen";
    this.fogParticleLayer.blendMode = "screen";
    this.root.addChild(this.fogGfx, this.fogAuraGfx, this.fogParticleLayer);
    this.setAnimated(false);
  }
  setTheme(theme: Theme): void {
    this.theme = theme;
    this.fogGradRight = this.fogGradLeft = this.fogAuraGradRight = this.fogAuraGradLeft = null;
    for (const group of this.fogParticleGroups)
      for (const particle of group.particles) this.paintFogParticle(particle);
  }
  clear(): void {
    this.fogGfx.clear();
    this.fogAuraGfx.clear();
    this.layoutFogParticleGroups(0, 0);
    this.setAnimated(false);
  }
  setAnimated(shouldAnimate: boolean): void {
    if (this.fogAnimationEnabled === shouldAnimate) return;
    this.fogAnimationEnabled = shouldAnimate;
    gsap.killTweensOf(this.fogAuraGfx);
    for (const group of this.fogParticleGroups)
      for (const particle of group.particles)
        this.setFogParticleAnimation(particle, shouldAnimate && group.container.visible);
    if (!shouldAnimate) {
      this.fogAuraGfx.alpha = VOID_AURA.idleAlpha;
      return;
    }
    gsap.fromTo(
      this.fogAuraGfx,
      { alpha: VOID_AURA.minAlpha },
      {
        alpha: VOID_AURA.maxAlpha,
        duration: VOID_AURA.durationSeconds,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        onUpdate: this.request,
      },
    );
  }
  draw(
    width: number,
    height: number,
    delimiters: readonly number[],
    focused: readonly number[],
    collapsedWidth: number,
  ): void {
    const shadow = this.fogGfx;
    const aura = this.fogAuraGfx;
    shadow.clear();
    aura.clear();
    const n = delimiters.length + 1;
    if (n <= 1 || width <= 0) {
      this.layoutFogParticleGroups(0, 0);
      return;
    }
    const leftEdge = (index: number) =>
      Math.round((index === 0 ? 0 : delimiters[index - 1]!) * width);
    const rightEdge = (index: number) =>
      Math.round((index === n - 1 ? 1 : delimiters[index]!) * width);
    const widthOf = (index: number) => rightEdge(index) - leftEdge(index);
    const span = width - n * collapsedWidth;
    const collapseAmount = (index: number) =>
      span <= 0 ? 0 : Math.min(1, Math.max(0, 1 - (widthOf(index) - collapsedWidth) / span));
    const focusedIds = new Set(focused);
    const gradients = this.fogGradients();
    this.layoutFogParticleGroups(n - 1, height);
    for (let index = 0; index < n - 1; index += 1) {
      const x = Math.round(delimiters[index]! * width);
      const leftWidth =
        DIVIDER.baseFadeWidthPx + DIVIDER.collapseFadeWidthPx * collapseAmount(index);
      const rightWidth =
        DIVIDER.baseFadeWidthPx + DIVIDER.collapseFadeWidthPx * collapseAmount(index + 1);
      const leftAuraWidth = leftWidth * DIVIDER.auraWidthRatio;
      const rightAuraWidth = rightWidth * DIVIDER.auraWidthRatio;
      const focusAdjacent = focusedIds.has(index) || focusedIds.has(index + 1);
      const particleGroup = this.fogParticleGroups[index]!;
      particleGroup.container.position.x = x;
      particleGroup.container.alpha =
        0.62 +
        0.24 * Math.max(collapseAmount(index), collapseAmount(index + 1)) +
        (focusAdjacent ? 0.12 : 0);
      particleGroup.container.scale.x = focusAdjacent ? 1.28 : 1;
      shadow.rect(x - leftWidth, 0, leftWidth, height).fill(gradients.shadowLeft);
      shadow.rect(x, 0, rightWidth, height).fill(gradients.shadowRight);
      aura.rect(x - leftAuraWidth, 0, leftAuraWidth, height).fill(gradients.auraLeft);
      aura.rect(x, 0, rightAuraWidth, height).fill(gradients.auraRight);
      shadow
        .rect(x - DIVIDER.barWidthPx / 2, 0, DIVIDER.barWidthPx, height)
        .fill({ color: hexToNum(this.theme.gameTheme.canvas.shadow), alpha: 0.9 });
      aura.rect(x - 0.5, 0, 1, height).fill({
        color: hexToNum(this.theme.appTheme.primary),
        alpha: focusAdjacent ? 0.52 : 0.24,
      });
    }
  }

  private fogGradients(): {
    shadowLeft: FillGradient;
    shadowRight: FillGradient;
    auraLeft: FillGradient;
    auraRight: FillGradient;
  } {
    if (
      !this.fogGradRight ||
      !this.fogGradLeft ||
      !this.fogAuraGradRight ||
      !this.fogAuraGradLeft
    ) {
      const linear = (stops: { offset: number; color: string }[]) =>
        new FillGradient({
          type: "linear",
          start: { x: 0, y: 0 },
          end: { x: 1, y: 0 },
          textureSpace: "local",
          colorStops: stops,
        });
      const shadow = withAlpha(this.theme.gameTheme.canvas.shadow, DIVIDER.shadowAlpha);
      const shadowClear = withAlpha(this.theme.gameTheme.canvas.shadow, 0);
      const aura = withAlpha(this.theme.appTheme.primary, DIVIDER.auraAlpha);
      const auraClear = withAlpha(this.theme.appTheme.primary, 0);
      this.fogGradRight = linear([
        { offset: 0, color: shadow },
        { offset: 1, color: shadowClear },
      ]);
      this.fogGradLeft = linear([
        { offset: 0, color: shadowClear },
        { offset: 1, color: shadow },
      ]);
      this.fogAuraGradRight = linear([
        { offset: 0, color: aura },
        { offset: 1, color: auraClear },
      ]);
      this.fogAuraGradLeft = linear([
        { offset: 0, color: auraClear },
        { offset: 1, color: aura },
      ]);
    }
    return {
      shadowLeft: this.fogGradLeft,
      shadowRight: this.fogGradRight,
      auraLeft: this.fogAuraGradLeft,
      auraRight: this.fogAuraGradRight,
    };
  }

  private layoutFogParticleGroups(count: number, height: number): void {
    while (this.fogParticleGroups.length < count) {
      const container = new Container();
      const particles = Array.from({ length: FOG_PARTICLE_COUNT }, (_, index) => {
        const spec = randomFogParticleSpec(index);
        const anchor = new Container();
        const dot = new Graphics();
        anchor.position.x = spec.x;
        anchor.addChild(dot);
        container.addChild(anchor);
        const particle: FogParticle = { anchor, dot, spec, animated: null };
        this.paintFogParticle(particle);
        this.setFogParticleAnimation(particle, this.fogAnimationEnabled === true);
        return particle;
      });
      this.fogParticleLayer.addChild(container);
      this.fogParticleGroups.push({ container, particles });
    }
    this.fogParticleGroups.forEach((group, groupIndex) => {
      const visible = groupIndex < count;
      if (group.container.visible !== visible) {
        group.container.visible = visible;
        for (const particle of group.particles) {
          this.setFogParticleAnimation(particle, visible && this.fogAnimationEnabled === true);
        }
      }
      if (!visible) return;
      group.particles.forEach((particle) => {
        particle.anchor.position.y = particle.spec.y * height;
      });
    });
  }

  private paintFogParticle(particle: FogParticle): void {
    particle.dot
      .clear()
      .circle(0, 0, particle.spec.radius)
      .fill({ color: hexToNum(this.theme.appTheme.primary) });
  }

  private setFogParticleAnimation(particle: FogParticle, animated: boolean): void {
    if (particle.animated === animated) return;
    particle.animated = animated;
    gsap.killTweensOf(particle.dot);
    particle.dot.position.set(-particle.spec.driftX / 2, particle.spec.driftY / 2);
    particle.dot.alpha = FOG_PARTICLE_ALPHA.idle;
    if (!animated) return;
    gsap.fromTo(
      particle.dot,
      {
        x: -particle.spec.driftX / 2,
        y: particle.spec.driftY / 2,
        alpha: FOG_PARTICLE_ALPHA.min,
      },
      {
        x: particle.spec.driftX / 2,
        y: -particle.spec.driftY / 2,
        alpha: FOG_PARTICLE_ALPHA.max,
        duration: particle.spec.duration,
        delay: particle.spec.delay,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        onUpdate: this.request,
      },
    );
  }
  destroy(): void {
    gsap.killTweensOf(this.fogAuraGfx);
    for (const group of this.fogParticleGroups)
      for (const particle of group.particles) gsap.killTweensOf(particle.dot);
    this.root.destroy({ children: true });
  }
}
