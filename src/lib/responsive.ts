// Kept in sync with Tailwind's default `md` breakpoint and utility classes
// like `md:hidden` / `hidden md:flex` so JS gates match the CSS.
export const DESKTOP_QUERY = "(min-width: 768px)";

// Landscape-phone heights: the hand fan drops to a smaller floor so the board
// and the floating action panel keep vertical room.
export const SHORT_SCREEN_QUERY = "(max-height: 520px)";

export const COARSE_POINTER_QUERY = "(pointer: coarse)";

export const LONG_PRESS_PREVIEW_MS = 450;
export const LONG_PRESS_CANCEL_DIST_SQ = 100;

export function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia(COARSE_POINTER_QUERY).matches;
}
