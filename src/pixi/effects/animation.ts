/**
 * Pure time-driven animation primitives. Callers pass `now` (ms) in — nothing
 * here reads the clock — so effects are deterministic and testable. Shared by
 * the per-sprite one-shots (`CardSprite.tickEffects`) and the looping glows.
 */

/** A transient animation: a start timestamp + a duration. */
export interface OneShot {
  readonly start: number;
  readonly durationMs: number;
}

export const oneShot = (now: number, durationMs: number): OneShot => ({ start: now, durationMs });

/**
 * Linear 0..1 progress of a one-shot, or `null` once it has finished — so the
 * caller can both drive the animation and know when to clear it:
 *
 *     this.popFx = (p => (p == null ? null : (apply(p), this.popFx)))(oneShotProgress(this.popFx, now));
 */
export const oneShotProgress = (s: OneShot | null, now: number): number | null => {
  if (!s) return null;
  const t = (now - s.start) / s.durationMs;
  return t >= 1 ? null : Math.max(0, t);
};

/** Looping sine in `[min, max]` with the given period (ms). */
export const pulse = (now: number, periodMs: number, min = 0, max = 1): number => {
  const phase = (Math.sin((now / periodMs) * Math.PI * 2) + 1) / 2;
  return min + (max - min) * phase;
};
