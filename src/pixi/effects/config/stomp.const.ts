/**
 * Creature-ETB squash tunables (GSAP, drives the card's `fxScale`). Kept snappy:
 * an instant squash on contact, then a springy settle. Durations are seconds.
 */
export const STOMP = {
  /** Instant squash on contact (wide + short). */
  squashX: 1.24,
  squashY: 0.78,
  /** Settle back to {1,1}. */
  settleSec: 0.26,
  /** GSAP ease string for the settle. */
  settleEase: "back.out(2.4)",
} as const;
