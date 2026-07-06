import { useSyncExternalStore } from "react";
import { SHORT_SCREEN_QUERY } from "@/lib/responsive";

/** Reference viewport width — sizes are authored at this width. */
const REF_WIDTH = 1440;

const MIN_SCALE = 0.65;
const MAX_SCALE = 1.3;
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

export function useHandScale() {
  return useSyncExternalStore(subscribe, getSnapshot, () => 1);
}
