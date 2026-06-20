import type { DestroyOptions } from "pixi.js";

/**
 * Linear-interpolate `current` toward `target` by `speed`, snapping to the
 * target once within `snap` to avoid endless sub-pixel easing.
 */
export const lerp = (current: number, target: number, speed: number, snap: number): number => {
  const d = target - current;
  return Math.abs(d) > snap ? current + d * speed : target;
};

/**
 * Destroy a Pixi display object and its child geometry. Defaults to
 * `{ children: true }` so Graphics/geometry GPU buffers are freed on mid-game
 * teardown instead of surviving until the Application is disposed. Texture and
 * style destruction are intentionally NOT defaulted: card textures come from
 * the shared Scryfall cache and most Text uses shared module-level styles —
 * objects that own such resources destroy them explicitly. The
 * `installPixiPatches` `returnTexture` guard makes cascading destroys safe;
 * the try/catch is a last resort so an internal Pixi bug can't crash the React
 * tree during teardown.
 */
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
