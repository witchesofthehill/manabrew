/**
 * Pure easing functions, `t` in 0..1 → eased 0..1 (some overshoot past 1).
 * Shared by every board animation so timing feels consistent.
 */

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;

/** Overshoots slightly past 1 before settling — a lively "pop". */
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Ramps 0→1→0 over the span — a single symmetric bump. */
export const bump = (t: number): number => Math.sin(Math.min(1, Math.max(0, t)) * Math.PI);
