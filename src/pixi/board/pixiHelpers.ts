/**
 * Linear-interpolate `current` toward `target` by `speed`, snapping to the
 * target once within `snap` to avoid endless sub-pixel easing.
 */
export const lerp = (current: number, target: number, speed: number, snap: number): number => {
  const d = target - current;
  return Math.abs(d) > snap ? current + d * speed : target;
};

/**
 * Destroy a Pixi display object without cascading into children. Pixi v8
 * can throw inside `TexturePool.returnTexture` when destroying certain Text
 * objects; dropping our own reference is enough — the leaked children get
 * collected when the Application is disposed. Wrapped so an internal Pixi
 * bug never crashes the React tree during teardown.
 */
export const safeDestroy = (obj: { destroy: (...args: never[]) => void }): void => {
  try {
    obj.destroy();
  } catch (err) {
    console.warn("[pixi] display-object destroy threw:", err);
  }
};
