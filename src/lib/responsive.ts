export const DESKTOP_QUERY = "(min-width: 768px)";

export const SHORT_SCREEN_QUERY = "(max-height: 520px)";

export const COARSE_POINTER_QUERY = "(pointer: coarse)";

export const PORTRAIT_QUERY = "(orientation: portrait)";

export const LANDSCAPE_GATE_MAX_WIDTH_QUERY = "(max-width: 1023px)";

export const LONG_PRESS_PREVIEW_MS = 450;
export const LONG_PRESS_CANCEL_DIST_SQ = 100;

export function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia(COARSE_POINTER_QUERY).matches;
}
