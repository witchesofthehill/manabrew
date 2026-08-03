import type { DestroyOptions } from "pixi.js";

const BASE_FRAME_MS = 1000 / 60;
let frameRatio = 1;

/**
 * Record the current ticker frame's delta so `lerp` speeds stay constant in
 * wall-clock time when the display is throttled (low-power 30Hz) or running
 * above 60Hz. Call once at the top of the ticker before any lerp-driven
 * animation. Returns the ratio for frame-counted animations to scale by.
 */
export const setFrameRatio = (deltaMS: number): number => {
  frameRatio = deltaMS / BASE_FRAME_MS;
  return frameRatio;
};

/**
 * Linear-interpolate `current` toward `target` by `speed`, snapping to the
 * target once within `snap` to avoid endless sub-pixel easing. `speed` is the
 * per-60Hz-frame fraction; the applied step is compensated by the frame ratio.
 */
export const lerp = (current: number, target: number, speed: number, snap: number): number => {
  const d = target - current;
  if (Math.abs(d) <= snap) return target;
  return current + d * (1 - Math.pow(1 - speed, frameRatio));
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
