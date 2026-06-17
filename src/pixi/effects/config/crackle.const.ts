/**
 * ETB ground-crackle tunables (radial fissures under the dust). Tweak here.
 * `color` is a fixed warm-sand aesthetic (not a theme token); lifetimes are in
 * animation frames (~60/s).
 */
export const CRACKLE = {
  color: 0xc7a35a,
  /** Radial arms: `armsMin` + up to `armsExtra` (random). */
  armsMin: 8,
  armsExtra: 4,
  /** Arm length in px: `lengthMin` + up to `lengthExtra`. */
  lengthMin: 20,
  lengthExtra: 30,
  /** Segments per arm — more = more jagged. */
  segments: 4,
  /** Angle jitter (radians) on the base direction and each segment. */
  baseJitter: 0.5,
  segmentJitter: 0.6,
  /** Vertical squash for ground perspective (y is multiplied by this). */
  flatten: 0.5,
  strokeWidth: 1.1,
  strokeAlpha: 0.95,
  /** Central impact blotch. */
  blotchRadiusX: 5,
  blotchRadiusY: 2.5,
  blotchAlpha: 0.4,
  /** Lifetime in frames. */
  lifeFrames: 22,
  /** Fraction of life held at full alpha before it fades out. */
  holdFraction: 0.08,
} as const;
