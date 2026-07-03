import { useSyncExternalStore } from "react";
import { SHORT_SCREEN_QUERY } from "@/lib/responsive";

/** Reference viewport width — sizes are authored at this width. */
const REF_WIDTH = 1440;

/** Clamp the scale so cards don't get absurdly tiny or huge. The upper bound
 *  lets 4K/ultrawide monitors grow the hand; `HandController.setScale` still
 *  shrink-caps by the play-zone height, so short-wide windows can't overflow. */
const MIN_SCALE = 0.65;
const MAX_SCALE = 1.8;
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
 * Returns a multiplier (MIN_SCALE–MAX_SCALE) that scales hand card sizes
 * proportionally to the viewport width, using REF_WIDTH as 1×.
 */
export function useHandScale() {
  return useSyncExternalStore(subscribe, getSnapshot, () => 1);
}
