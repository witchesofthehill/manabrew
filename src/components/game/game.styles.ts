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

export const BATTLEFIELD_CARD = "w-[70px] h-[98px] shrink-0" as const;
export const HAND_CARD = "w-[80px] h-[112px]" as const;

export const HAND_CARD_BASE = { cardW: 130, cardH: 182, containerH: 220 } as const;
export const MODAL_CARD_SIZE = "w-[100px] h-[140px]" as const;
export const FLASH_CARD_SIZE = { w: 310, h: 434 } as const;
export const MULLIGAN_CARD_SIZE = "w-[160px] h-[222px]" as const;
export const CHOOSE_CARD_TILE_SIZE = "w-[94px] sm:w-[150px]" as const;
export const PROMPT_SOURCE_CARD_SIZE = {
  vertical: "w-[200px]",
  verticalCompact: "w-[110px]",
  horizontal: "w-[220px]",
  horizontalCompact: "w-[120px]",
} as const;

export const MODAL_CARD_THUMBNAIL =
  "w-[60px] h-[84px] rounded-md object-cover shrink-0 shadow-md" as const;

export const MODAL_CARD_IMAGE =
  "w-[120px] h-[168px] rounded-lg object-cover shrink-0 shadow-md" as const;

export const MODAL_INPUT =
  "w-full px-3 py-1.5 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary" as const;

export const MODAL_LIST_BUTTON = [
  "w-full text-left px-3 py-2 rounded-md border text-sm font-medium transition-all",
  "hover:border-primary/50 hover:bg-muted/50",
  "border-border bg-background",
].join(" ") as string;

export const MODAL_PILL_BUTTON = [
  "px-3 py-1.5 rounded-md border text-sm font-medium transition-all",
  "hover:border-primary/50 hover:bg-muted/50",
  "border-border bg-background",
].join(" ") as string;

export const MODAL_FOOTER_BETWEEN =
  "flex justify-between items-center px-4 py-3 border-t bg-muted/10 rounded-b-xl gap-2" as const;

export const ZONE_LABEL =
  "text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1" as const;

export const PROMPT_BUTTON_COLUMN = "flex flex-col gap-2 items-start [&_button]:w-fit" as const;

export const PROMPT_HINT = "text-xs text-muted-foreground" as const;

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
  "h-8 text-xs font-semibold border-b-2 -mb-px transition-colors" as const;

export const TAB_ACTIVE = "text-foreground border-foreground" as const;

export const TAB_INACTIVE =
  "text-muted-foreground border-transparent hover:text-foreground" as const;
