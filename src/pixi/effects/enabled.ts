let enabled = true;
const reducedMotion =
  typeof window === "undefined" ? null : window.matchMedia("(prefers-reduced-motion: reduce)");
const listeners = new Set<() => void>();

export const animationsEnabled = (): boolean => enabled && !reducedMotion?.matches;

export const subscribeAnimationsEnabled = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setAnimationsEnabled = (value: boolean): void => {
  if (enabled === value) return;
  enabled = value;
  for (const listener of listeners) listener();
};
