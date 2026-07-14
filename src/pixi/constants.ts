import { CARD_GAP } from "@/components/game/game.constants";

export const GAP = CARD_GAP;
export const ATTACH_OFFSET_Y = 16;
// Cards in a stack that fan out in the staircase before the rest collapse onto
// one another; caps the visual height of huge token piles (the ×N badge carries
// the count).
export const STACK_MAX_SLIDE_CARDS = 2;
export const CARD_RADIUS = 6;
export const TABLE_RADIUS = 8;
export const MAX_LAND_SLOTS = 100;
export const MAX_GRID_SLOTS = 200;

export const BATTLEFIELD_CARD_SCALE_DEFAULT = 1.15;
// Absolute floor so cards never go microscopic on very short displays.
export const BATTLEFIELD_CARD_SCALE_FLOOR = 0.5;
// Low enough that 3 rows + the combat band always fit on a landscape phone —
// the row lock in BoardCanvas.reconfigure is what actually picks the scale.
export const BATTLEFIELD_CARD_SCALE_FLOOR_COMPACT = 0.2;
export const BATTLEFIELD_MIN_ROWS = 3;
// The card-size multiplier's ceiling: a field may drop to 2 rows of big cards,
// never 1 — a single row makes the game unplayable (PR #450 review). Compact
// mode keeps the 3-row lock.
export const BATTLEFIELD_MIN_ROWS_LARGEST = 2;
// Panel wider than this fraction of the canvas reserves the whole top row.
export const OPPONENT_PANEL_FULLWIDTH_FRAC = 0.4;

export const GRID_SKELETON_STROKE_ALPHA = 0.25;
export const GRID_SKELETON_HOVER_ALPHA = 0.9;
export const GRID_SKELETON_STACK_ALPHA = 0.85;
export const GRID_SKELETON_FILL_ALPHA = 0.04;
export const GRID_SKELETON_STACK_FILL_ALPHA = 0.22;
export const GRID_SKELETON_STROKE_ALPHA_COMPACT = 0.6;
export const GRID_SKELETON_FILL_ALPHA_COMPACT = 0.1;
// Under all battlefield cards (whose targetZIndex is >= 1) so dragged sprites
// stay visible on top of it.
export const Z_GRID_SKELETON = -1;

// Hand scales to the canvas width, not the window — the canvas is narrower than
// the window (zone columns + right panel), so window-based sizing renders hand
// cards too large for the available space.
export const HAND_REF_WIDTH = 1440;
export const HAND_MIN_SCALE = 0.55;
export const HAND_MAX_SCALE = 1.3;
// Cap (shrink-only) so the width-derived hand scale can't make the fan taller
// than its region and overflow the battlefield on a short window.
export const HAND_MAX_ZONE_HEIGHT_FRACTION = 0.6;

// Defers the hand-hover clear so an HTML overlay (action menu) can cancel it when
// the cursor leaves the sprite but re-enters the menu.
export const HAND_HOVER_HOLD_MS = 150;
export const BATTLEFIELD_HOVER_HOLD_MS = 60;
export const HAND_ACTIONS_CLEAR_DELAY_MS = 180;
// Window during which a just-resolved spell's last-known stack position seeds its
// battlefield sprite's entering animation.
export const STACK_SEED_TTL_MS = 1000;
export const HAND_ACTIONS_GAP_PX = 15;
export const FPS_SAMPLE_INTERVAL_MS = 500;
export const PIXI_MAX_FPS = 60;

export const BATTLEFIELD_LERP = 0.15;
export const HAND_LERP = 0.18;
export const HOVER_SCALE_LERP = 0.2;
export const ROTATION_LERP = 0.22;
export const OVERLAY_FADE_LERP = 0.2;
export const HOVER_SCALE = 1.08;
export const SNAP_PX = 0.5;
export const SNAP_SCALE = 0.001;
export const SNAP_ROT = 0.001;
export const SNAP_ALPHA = 0.01;
export const SNAP_HAND_SCALE = 0.002;

// Side-by-side spacing of multiple blockers sharing one attacker, as a fraction
// of card width.
export const COMBAT_STAGE_FAN_FRAC = 0.7;

export const DAMAGE_SHAKE_FRAMES = 14;
export const DAMAGE_SHAKE_AMP_PX = 4;

export const FLOATER_LIFETIME_FRAMES = 48;
export const FLOATER_RISE_PER_FRAME = 0.7;
export const FLOATER_FONT_SIZE = 24;

export const CAST_DRAG_SCALE = 1.25;
export const CAST_DRAG_CARD_DROP_PX = 16;
export const CAST_DRAG_HAND_SINK_PX = 200;

export const EXIT_FADE_LERP = 0.2;
export const EXIT_SHRINK = 0.95;
export const COMBAT_STAGE_PADDING_PX = 6;
export const COMBAT_ROW_PAD_Y = 8;
// The local grid + its card-scale reserve only this fraction of the hand-fan
// height (the fan extends partly below the field and renders on top), so the
// bottom row can grow down behind the hand. The action overlay keeps the full
// reserve so it never sits under the hand.
export const HAND_RESERVE_TRIM = 0.65;
export const HAND_RESERVE_TRIM_COMPACT = 0.4;
export const HAND_BOTTOM_SINK_FRAC = 0.45;
export const HAND_BOTTOM_SINK_FRAC_COMPACT = 0.68;
// Extra upward tilt for the local player's staged creatures — the self region
// sits right at the bar, so its creatures can come up a touch further.
export const COMBAT_STAGE_SELF_EXTRA_PX = 18;
export const COMBAT_BLOCKER_OVERLAP_FRAC = 0.4;
export const COMBAT_ROW_STEP_FRAC = 1.12;
export const Z_STAGED_REGION = 8000;
// Combat-row attackers that travelled in from another player's field render in
// an unclipped scene layer (above every region's accordion mask) so they glide
// across the board into a collapsed defender's row instead of popping in.
export const Z_COMBAT_GUEST = 8500;
export const PHASE_STRIP_COMBAT_ALPHA = 0.25;
export const STRIP_COMPACT_EXPAND_TIMEOUT_MS = 5000;
export const STRIP_EXPANDED_BG_ALPHA = 0.92;
export const COMBAT_DIM_ALPHA = 0.3;
// Tint rather than alpha so overlapping stacked cards don't show through each
// other; 1 = full color.
export const COMBAT_DIM_TINT_LEVEL = 0.42;
export const DOOMED_FILL_ALPHA = 0.42;

export const Z_COMBAT_STAGED = 400;
export const Z_PLACEMENT_GHOST = 500;
export const Z_PLACEMENT_GHOST_TEXT = 501;
export const Z_HAND_CONTAINER = 9600;
export const Z_HAND_HOVERED = 100;
export const Z_OVERLAY_OFFSET = 100;
export const Z_SELECTION_BADGE = 9500;
export const Z_HAND_ACTIONS_MENU = 200;

export const BG_ALPHA_IDLE = 0.4;
export const STRIP_TURN_ALPHA = 0.85;
export const BG_ALPHA_DROP = 0.15;
export const DROP_STROKE_ALPHA = 0.8;
export const DROP_TINT_ALPHA = 0.06;
export const GHOST_STROKE_ALPHA = 0.55;
export const GHOST_FILL_ALPHA = 0.08;

export const PLAYABLE_RING_ALPHA = 0.85;
export const PLAYABLE_HIGHLIGHT_ALPHA = 0.3;
export const MANA_BUTTON_ALPHA = 0.45;
export const MANA_BUTTON_HOVER_ALPHA = 0.75;
export const MANA_BUTTON_STROKE_ALPHA = 0.2;
export const MANA_BUTTON_STROKE_HOVER_ALPHA = 0.55;
export const ACTION_BUTTON_ALPHA = 0.4;
export const ACTION_BUTTON_HOVER_ALPHA = 0.65;
export const SELECT_BUTTON_ALPHA = 0.3;
export const SELECT_BUTTON_HOVER_ALPHA = 0.55;
export const ICON_BG_ALPHA = 0.4;
export const ICON_HOVER_SCALE = 1.12;

export const OVERLAY_LABEL_TAP = "TAP";
export const OVERLAY_LABEL_UNTAP = "UNTAP";
export const OVERLAY_LABEL_SELECT = "SELECT";

export const SYMBOL_TAP = "T";
export const SYMBOL_UNTAP = "Q";
