import { useSyncExternalStore } from "react";
import { SHORT_SCREEN_QUERY } from "@/lib/responsive";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

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

/** The hand follows the card-size slider at HALF rate: full-rate growth made
 *  the fan so wide/tall that its grid blocker swallowed the whole bottom
 *  battlefield row, and it dwarfed the (2-row-capped) battlefield cards. */
const HAND_GROWTH_DAMP = 0.5;

export function handSizeMultiplier(cardSizeMultiplier: number): number {
  return 1 + (cardSizeMultiplier - 1) * HAND_GROWTH_DAMP;
}

/** Viewport-derived hand scale times the (damped) card-size multiplier.
 *  Single source of truth for the fan itself (BoardCanvas → setHandScale),
 *  the hand reserve (GameBoard), and the drag ghosts (Game.tsx) — the fan and
 *  the grid reserve must never disagree, or a grown fan eats the bottom
 *  battlefield row through its cell blocker. */
export function useHandScale() {
  const viewportScale = useSyncExternalStore(subscribe, getSnapshot, () => 1);
  const cardSizeMultiplier = usePreferencesStore((s) => s.cardSizeMultiplier);
  return viewportScale * handSizeMultiplier(cardSizeMultiplier);
}
