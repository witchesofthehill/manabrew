import { GAME_CARD_SIZES } from "./game.constants";

/**
 * Shared Tailwind class constants for game components.
 *
 * Extracting repeated class strings into named constants improves
 * consistency and makes bulk style changes easier.
 */

export const CARD_RING = {
  selectable: "ring-2 cursor-pointer",
  pending: "ring-2 cursor-pointer",
  attacking: "ring-2 cursor-pointer",
  tappable: "ring-2 cursor-pointer",
  untappable: "ring-2 cursor-pointer",
  selected: "ring-2",
} as const;

export const HAND_CARD_BASE = {
  cardW: GAME_CARD_SIZES.hand.width,
  cardH: GAME_CARD_SIZES.hand.height,
  containerH: 220,
} as const;

export const MODAL_INPUT =
  "w-full min-h-8 touch:min-h-11 px-3 py-1.5 rounded-md border bg-background text-ui-input focus:outline-none focus:ring-1 focus:ring-primary" as const;

export const MODAL_LIST_BUTTON = [
  "w-full min-h-8 touch:min-h-11 touch:min-w-11 text-left px-3 py-2 rounded-md border text-ui-label font-medium whitespace-normal break-words transition-all",
  "hover:border-primary/50 hover:bg-muted/50",
  "border-border bg-background",
].join(" ") as string;

export const MODAL_PILL_BUTTON = [
  "min-h-8 touch:min-h-11 touch:min-w-11 px-3 py-1.5 rounded-md border text-ui-label font-medium whitespace-normal break-words transition-all",
  "hover:border-primary/50 hover:bg-muted/50",
  "border-border bg-background",
].join(" ") as string;

export const MODAL_FOOTER_BETWEEN =
  "flex flex-wrap justify-between items-center px-4 py-3 border-t bg-muted/10 rounded-b-xl gap-2" as const;

export const ZONE_LABEL =
  "text-ui-meta font-semibold text-muted-foreground uppercase tracking-wide px-1" as const;

export const PROMPT_BUTTON_COLUMN = "flex flex-col gap-2 items-start [&_button]:w-fit" as const;

export const PROMPT_HINT = "text-ui-meta text-muted-foreground" as const;

/**
 * Container for card status badges (Exerted, Morph, Bestow, Token,
 * Transformed, Plotted, Madness, Warped). Sits just below the MTG title
 * line so the top-right mana cost pip cluster is never obscured — the
 * Pixi `CardSprite` mirrors this offset with `BADGE_TITLE_BAND_FRAC`.
 */
export const CARD_BANNER_CONTAINER =
  "absolute top-[10%] left-0 right-0 flex justify-center z-20 pointer-events-none" as const;

/** Base text style for card banner badges — kept compact so the badge
 *  stays comfortably narrower than the card width at every hover scale. */
export const CARD_BANNER_TEXT = "text-[7px] font-bold px-1 py-[1px] rounded leading-none" as const;

export const BUTTON_CONFIRM_BLOCKS = "" as const;

export const TAB_BUTTON_BASE =
  "min-h-8 touch:min-h-11 touch:min-w-11 px-1 py-1 text-ui-label font-semibold border-b-2 -mb-px whitespace-normal transition-colors" as const;

export const TAB_ACTIVE = "text-foreground border-foreground" as const;

export const TAB_INACTIVE =
  "text-muted-foreground border-transparent hover:text-foreground" as const;
