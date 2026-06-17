export interface OneShot {
  readonly start: number;
  readonly durationMs: number;
}

export const oneShot = (now: number, durationMs: number): OneShot => ({ start: now, durationMs });

export const oneShotProgress = (s: OneShot | null, now: number): number | null => {
  if (!s) return null;
  const t = (now - s.start) / s.durationMs;
  return t >= 1 ? null : Math.max(0, t);
};

export const pulse = (now: number, periodMs: number, min = 0, max = 1): number => {
  const phase = (Math.sin((now / periodMs) * Math.PI * 2) + 1) / 2;
  return min + (max - min) * phase;
};
