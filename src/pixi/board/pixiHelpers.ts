import type { DestroyOptions } from "pixi.js";

/**
 * Linear-interpolate `current` toward `target` by `speed`, snapping to the
 * target once within `snap` to avoid endless sub-pixel easing.
 */
export const lerp = (current: number, target: number, speed: number, snap: number): number => {
  const d = target - current;
  return Math.abs(d) > snap ? current + d * speed : target;
};

export const safeDestroy = (
  obj: { destroy: (options?: DestroyOptions) => void },
  options: DestroyOptions = { children: true },
): void => {
  try {
    obj.destroy(options);
  } catch (err) {
    console.warn("[pixi] display-object destroy threw:", err);
  }
};
