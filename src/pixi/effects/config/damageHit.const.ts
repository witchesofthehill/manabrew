/**
 * White impact flash when a creature takes damage (alongside the wash + shake +
 * floater). Color is theme-driven (`textOnTinted`); timing/intensity here.
 */
export const DAMAGE_HIT = {
  /** Flash duration in ms (rises then falls via `bump`). */
  durationMs: 260,
  /** Peak flash alpha. */
  maxAlpha: 0.5,
} as const;
