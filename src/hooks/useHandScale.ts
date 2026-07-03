import { useSyncExternalStore } from "react";

/** Reference viewport width — sizes are authored at this width. */
const REF_WIDTH = 1440;

/** Clamp the scale so cards don't get absurdly tiny or huge. */
const MIN_SCALE = 0.65;
const MAX_SCALE = 1.3;

/** Landscape-phone heights: the hand fan drops to a smaller floor so the board
 *  and the floating action panel keep vertical room. Shared with panels that
 *  reposition themselves on short screens. */
export const SHORT_SCREEN_QUERY = "(max-height: 520px)";
const SHORT_MAX_SCALE = 0.55;
const SHORT_MIN_SCALE = 0.5;

function getScale() {
  const s = window.innerWidth / REF_WIDTH;
  if (window.matchMedia(SHORT_SCREEN_QUERY).matches) {
    return Math.min(SHORT_MAX_SCALE, Math.max(SHORT_MIN_SCALE, s));
  }
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
}

function subscribe(cb: () => void) {
  const handler = () => cb();
  window.addEventListener("resize", handler);
  return () => window.removeEventListener("resize", handler);
}

function getSnapshot() {
  return getScale();
}

/**
 * Returns a multiplier (0.45–1.3) that scales hand card sizes
 * proportionally to the viewport width, using 1920px as 1×.
 */
export function useHandScale() {
  return useSyncExternalStore(subscribe, getSnapshot, () => 1);
}
