// Kept in sync with Tailwind's default `md` breakpoint and utility classes
// like `md:hidden` / `hidden md:flex` so JS gates match the CSS.
export const DESKTOP_QUERY = "(min-width: 768px)";

// Landscape-phone heights: the hand fan drops to a smaller floor so the board
// and the floating action panel keep vertical room.
export const SHORT_SCREEN_QUERY = "(max-height: 520px)";

export const COARSE_POINTER_QUERY = "(pointer: coarse)";

export const PORTRAIT_QUERY = "(orientation: portrait)";

// Tailwind's `lg` boundary — below it the landscape gate treats a portrait
// touch screen as a phone/small tablet that must rotate.
export const LANDSCAPE_GATE_MAX_WIDTH_QUERY = "(max-width: 1023px)";

export const LONG_PRESS_PREVIEW_MS = 450;
export const LONG_PRESS_CANCEL_DIST_SQ = 100;

export function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia(COARSE_POINTER_QUERY).matches;
}
