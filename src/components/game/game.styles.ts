/**
 * Shared Tailwind class constants for game components.
 *
 * Extracting repeated class strings into named constants improves
 * consistency and makes bulk style changes easier.
 */

// ── Card ring variants ────────────────────────────────────────────────────

export const CARD_RING = {
  selectable: "ring-2 cursor-pointer",
  pending: "ring-2 cursor-pointer",
  attacking: "ring-2 cursor-pointer",
  tappable: "ring-2 cursor-pointer",
  untappable: "ring-2 cursor-pointer",
  selected: "ring-2",
} as const;

// ── Card sizing ────────────────────────────────────────────────────────────

export const BATTLEFIELD_CARD = "w-[70px] h-[98px] shrink-0" as const;
export const HAND_CARD = "w-[80px] h-[112px]" as const;

/** Base hand card sizes at 1920px reference width (scaled at runtime by useHandScale). */
export const HAND_CARD_BASE = { cardW: 130, cardH: 182, containerH: 220 } as const;
/** Cards inside modal grids (e.g., LibraryPeekModal, SpellStackModal, ZoneTargetSelector) */
export const MODAL_CARD_SIZE = "w-[100px] h-[140px]" as const;
/** Large preview card (e.g., CardPreview floating overlay) */
export const FLASH_CARD_SIZE = { w: 310, h: 434 } as const;
/** Cards inside mulligan modals */
export const MULLIGAN_CARD_SIZE = "w-[160px] h-[222px]" as const;

// ── Modal shared styles ────────────────────────────────────────────────────

/** Small card thumbnail used in modal headers (e.g., ChooseModeModal, AbilityPickerModal) */
export const MODAL_CARD_THUMBNAIL =
  "w-[60px] h-[84px] rounded-md object-cover shrink-0 shadow-md" as const;

/** Larger card image used in modal bodies (e.g., CostModal, ChooseOptionalTriggerModal) */
export const MODAL_CARD_IMAGE =
  "w-[120px] h-[168px] rounded-lg object-cover shrink-0 shadow-md" as const;

/** Text input field used in filter/search inputs inside modals */
export const MODAL_INPUT =
  "w-full px-3 py-1.5 rounded-md border bg-background text-sm focus:outline-none focus:ring-1 focus:ring-primary" as const;

/** List button item used in type/name/mode pickers */
export const MODAL_LIST_BUTTON = [
  "w-full text-left px-3 py-2 rounded-md border text-sm font-medium transition-all",
  "hover:border-primary/50 hover:bg-muted/50",
  "border-border bg-background",
].join(" ") as string;

/** Pill-style button for grids (e.g., ChooseTypeModal, ChooseNumberModal) */
export const MODAL_PILL_BUTTON = [
  "px-3 py-1.5 rounded-md border text-sm font-medium transition-all",
  "hover:border-primary/50 hover:bg-muted/50",
  "border-border bg-background",
].join(" ") as string;

/** Modal footer with justify-between layout */
export const MODAL_FOOTER_BETWEEN =
  "flex justify-between items-center px-4 py-3 border-t bg-muted/10 rounded-b-xl gap-2" as const;

// ── Zone label ─────────────────────────────────────────────────────────────

export const ZONE_LABEL =
  "text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1" as const;

// ── Action panel ──────────────────────────────────────────────────────────

/** Button column layout used in PromptActionController */
export const PROMPT_BUTTON_COLUMN = "flex flex-col gap-2 items-start [&_button]:w-fit" as const;

/** Muted hint text used across prompt/modal contexts */
export const PROMPT_HINT = "text-xs text-muted-foreground" as const;

// ── Card badge / banner ──────────────────────────────────────────────────

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

/** Attack confirm button */
export const BUTTON_ATTACK = "flex items-center gap-1" as const;

/** Block confirm button */
export const BUTTON_CONFIRM_BLOCKS = "" as const;

/** Tab button base style for RightActionPanel */
export const TAB_BUTTON_BASE =
  "h-8 text-xs font-semibold border-b-2 -mb-px transition-colors" as const;

/** Active tab state */
export const TAB_ACTIVE = "text-foreground border-foreground" as const;

/** Inactive tab state */
export const TAB_INACTIVE =
  "text-muted-foreground border-transparent hover:text-foreground" as const;
