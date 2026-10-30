export const DESKTOP_QUERY = "(min-width: 768px)";

export const SHORT_SCREEN_MAX_HEIGHT_PX = 520;
export const SHORT_SCREEN_QUERY = `(max-height: ${SHORT_SCREEN_MAX_HEIGHT_PX}px)`;

export const COARSE_POINTER_QUERY = "(pointer: coarse)";
export const TOUCH_CAPABLE_QUERY = "(any-pointer: coarse)";

export const MOBILE_GAME_MAX_EDGE_PX = 1024;
export const MOBILE_GAME_QUERY = `${COARSE_POINTER_QUERY} and (max-width: ${MOBILE_GAME_MAX_EDGE_PX}px)`;

// The screen, not the viewport: Safari's toolbars put a 1032px-tall landscape iPad under the cutoff.
export function screenShortEdge(): number {
  return typeof window === "undefined"
    ? Number.POSITIVE_INFINITY
    : Math.min(window.screen.width, window.screen.height);
}

export const PORTRAIT_QUERY = "(orientation: portrait)";

// Phone-width cutoff: tablets (portrait ≥ ~744px) have room to play in portrait
// and must not be forced to rotate; only phone-sized viewports are gated.
export const LANDSCAPE_GATE_MAX_WIDTH_QUERY = "(max-width: 640px)";

export const LONG_PRESS_PREVIEW_MS = 450;
export const TOUCH_MOVE_SLOP_PX = 10;
export const LONG_PRESS_CANCEL_DIST_SQ = TOUCH_MOVE_SLOP_PX ** 2;

export function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia(COARSE_POINTER_QUERY).matches;
}
// Delay before an overlay's outside-tap dismissal arms: the synthetic click a
// touch tap fires lands AFTER the overlay mounts and must not dismiss it.
export const GHOST_CLICK_ARM_MS = 150;
