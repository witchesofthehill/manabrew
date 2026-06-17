/**
 * ETB dust-cloud tunables (native ParticleContainer burst). Tweak here.
 * `color` is a fixed pale-sand aesthetic (not a theme token); lifetimes are in
 * animation frames (~60/s).
 */
export const DUST = {
  color: 0xd9c8a0,
  /** Particles spawned per burst. */
  count: 34,
  /** Outward speed (px/frame): `speedMin` + up to `speedExtra` (wide → some hang). */
  speedMin: 0.4,
  speedExtra: 2.6,
  /** Initial scale: `scaleMin` + up to `scaleExtra`. */
  scaleMin: 0.2,
  scaleExtra: 0.55,
  /** Upward billow on spawn (px/frame): `upwardMin` + up to `upwardExtra`. */
  upwardMin: 0.4,
  upwardExtra: 0.9,
  /** Vertical squash of the outward spread (ground perspective). */
  flatten: 0.55,
  /** Per-frame downward pull and air drag. */
  gravity: 0.04,
  dragX: 0.88,
  dragY: 0.9,
  /** Spawn alpha (fades to 0 over life). */
  alpha: 0.45,
  /** Lifetime in frames: `lifeMin` + up to `lifeExtra`. */
  lifeMin: 26,
  lifeExtra: 20,
  /** Growth over life: scale = s0 * (1 + t * growth). */
  growth: 2.8,
} as const;
