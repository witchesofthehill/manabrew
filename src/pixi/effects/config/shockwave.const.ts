/**
 * ETB shockwave — a thin ring expanding outward across the ground from the foot
 * and fading (the radial energy of the landing, MTGA-style). Flattened into
 * ground perspective; the stroke thins as it grows. Lifetime in animation
 * frames (~60/s).
 */
export const SHOCKWAVE = {
  color: 0xe9d9ad,
  startRadius: 6,
  endRadius: 48,
  strokeWidth: 2.5,
  /** Peak alpha (fades to 0 over life). */
  alpha: 0.6,
  /** Vertical squash for ground perspective. */
  flatten: 0.42,
  lifeFrames: 20,
} as const;
