/**
 * ETB impact bloom — a bright flash at the foot the instant the creature lands
 * (the "pop" that makes the entrance read, MTGA-style), scaling up + fading
 * fast. Warm sand/gold to match the dust + crackle. Lifetime in animation
 * frames (~60/s).
 */
export const FLASH = {
  color: 0xfff2cf,
  startRadius: 8,
  endRadius: 34,
  /** Peak alpha (fades to 0 over life). */
  alpha: 0.7,
  /** Vertical squash for ground perspective. */
  flatten: 0.6,
  lifeFrames: 12,
} as const;
