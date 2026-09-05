let enabled = true;
const reducedMotion =
  typeof window === "undefined" ? null : window.matchMedia("(prefers-reduced-motion: reduce)");

export const animationsEnabled = (): boolean => enabled && !reducedMotion?.matches;

export const setAnimationsEnabled = (value: boolean): void => {
  enabled = value;
};
