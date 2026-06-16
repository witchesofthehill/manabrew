/**
 * Tuning constants for the Pixi renderer. Anything numeric that controls
 * animation, layering, or layout lives here so the scene file only reads
 * from a single source of truth.
 */

import { CARD_GAP } from "@/components/game/game.constants";

// ── Layout / geometry ──────────────────────────────────────────────────────
export const GAP = CARD_GAP;
export const ATTACH_OFFSET_Y = 16;
// Cards in a stack (identical-token group or attachment pile) that fan out in
// the staircase before the rest collapse onto one another. Caps the visual
// height of huge token piles (e.g. 11 Treasures) — the ×N badge carries count.
export const STACK_MAX_SLIDE_CARDS = 5;
export const CARD_RADIUS = 6;
export const TABLE_RADIUS = 8;
export const MAX_LAND_SLOTS = 100;
export const MAX_GRID_SLOTS = 200;

// ── Battlefield card scale ─────────────────────────────────────────────────
// Multiplier applied to battlefield sprites (and their grid cell footprint).
export const BATTLEFIELD_CARD_SCALE_DEFAULT = 1.15;
// Absolute floor so cards never go microscopic on very short displays.
export const BATTLEFIELD_CARD_SCALE_FLOOR = 0.5;
export const BATTLEFIELD_MIN_ROWS = 3;
export const BATTLEFIELD_MAX_ROWS = 4;
// Panel wider than this fraction of the canvas reserves the whole top row.
export const OPPONENT_PANEL_FULLWIDTH_FRAC = 0.4;

// ── Grid skeleton ──────────────────────────────────────────────────────────
export const GRID_SKELETON_STROKE_ALPHA = 0.25;
export const GRID_SKELETON_HOVER_ALPHA = 0.9;
export const GRID_SKELETON_STACK_ALPHA = 0.85;
export const GRID_SKELETON_FILL_ALPHA = 0.04;
export const GRID_SKELETON_STACK_FILL_ALPHA = 0.22;
// Grid skeleton sits under all battlefield cards (whose targetZIndex is
// >= 1) so dragged sprites remain fully visible on top of it.
export const Z_GRID_SKELETON = -1;

// ── Hand scaling ───────────────────────────────────────────────────────────
// Hand scales to the canvas width, not the window — the canvas is narrower
// than the window (zone columns + right panel), so window-based sizing
// renders hand cards too large for the available space.
export const HAND_REF_WIDTH = 1440;
export const HAND_MIN_SCALE = 0.55;
export const HAND_MAX_SCALE = 1.3;

// ── Hover timing ───────────────────────────────────────────────────────────
// Defers the hand-hover clear so an HTML overlay (action menu) can cancel
// it when the cursor leaves the sprite but re-enters the menu.
export const HAND_HOVER_HOLD_MS = 150;
// Same pattern for battlefield card → overlay button transitions.
export const BATTLEFIELD_HOVER_HOLD_MS = 60;
// React-side debounce for the hand action-menu portal.
export const HAND_ACTIONS_CLEAR_DELAY_MS = 180;
// Window during which a just-resolved spell's last-known stack position
// is still used to seed its battlefield sprite's entering animation.
export const STACK_SEED_TTL_MS = 1000;
// Gap between the hovered hand card and its action menu.
export const HAND_ACTIONS_GAP_PX = 15;
// How often we flush FPS samples to the dev store.
export const FPS_SAMPLE_INTERVAL_MS = 500;
export const PIXI_MAX_FPS = 60;

// ── Animation ──────────────────────────────────────────────────────────────
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

// ── Combat staging (MTGA-style blocker/attacker line-up) ────────────────────
// Side-by-side spacing of multiple blockers sharing one attacker, as a
// fraction of card width.
export const COMBAT_STAGE_FAN_FRAC = 0.7;

// ── Damage shake ────────────────────────────────────────────────────────────
// A creature jitters for this many frames when it takes new damage, decaying
// from this peak amplitude (px).
export const DAMAGE_SHAKE_FRAMES = 14;
export const DAMAGE_SHAKE_AMP_PX = 4;

// ── Floating numbers (combat damage / life change) ──────────────────────────
// A "-N" damage number rises and fades over the card / avatar it hit.
export const FLOATER_LIFETIME_FRAMES = 48;
export const FLOATER_RISE_PER_FRAME = 0.7;
export const FLOATER_FONT_SIZE = 24;

// ── Drag-to-cast feedback ───────────────────────────────────────────────────
// While dragging a card out of hand to cast it: the dragged permanent scales up
// and lifts slightly; the rest of the hand sinks out of the way (more for an
// instant, which reveals a full-field drop highlight instead of grid cells).
export const CAST_DRAG_SCALE = 1.25;
export const CAST_DRAG_CARD_DROP_PX = 16;
export const CAST_DRAG_HAND_SINK_PX = 200;

// ── Card exit (leaving the battlefield) ─────────────────────────────────────
// A removed card fades + shrinks instead of popping out; destroyed once faded.
export const EXIT_FADE_LERP = 0.2;
export const EXIT_SHRINK = 0.95;
// Gap (px) between a staged card's edge and the phase-strip border. The card
// tilts as close to the bar as possible without overlapping it, at any scale.
export const COMBAT_STAGE_PADDING_PX = 6;
// Extra upward tilt (px) for the local player's staged creatures — the self
// region sits right at the bar, so its creatures can come up a touch further.
export const COMBAT_STAGE_SELF_EXTRA_PX = 18;
// How far a blocker sits from its attacker's center, as a fraction of card
// height, when it slides onto the attacker (so both stay readable). The blocker
// overlaps the attacker's near edge and crosses the bar to reach it.
export const COMBAT_BLOCKER_OVERLAP_FRAC = 0.4;
// zIndex for a region while it has active combat staging — lifted above the
// phase strip so staged cards read on top of the center band.
export const Z_STAGED_REGION = 8000;
// Phase strip opacity while combat staging is active — dimmed so the staged
// cards crossing the center band read clearly on top of it.
export const PHASE_STRIP_COMBAT_ALPHA = 0.25;
// Opacity of phased-out cards (a genuine ghostly fade).
export const COMBAT_DIM_ALPHA = 0.3;
// Brightness of non-combat cards while combat is in progress (a darkening tint,
// 1 = full color). Tint rather than alpha so overlapping stacked cards don't
// show through each other. Combatants and the hovered card stay at full bright.
export const COMBAT_DIM_TINT_LEVEL = 0.42;
// Red wash laid over a creature the combat preview predicts will die, so the
// "lethal" state reads as a doomed card rather than just another red ring
// (pt.lethal shares the attacker-ring red).
export const DOOMED_FILL_ALPHA = 0.42;

// ── zIndex layers ──────────────────────────────────────────────────────────
export const Z_COMBAT_STAGED = 400;
export const Z_PLACEMENT_GHOST = 500;
export const Z_PLACEMENT_GHOST_TEXT = 501;
export const Z_HAND_CONTAINER = 5000;
export const Z_HAND_HOVERED = 100;
export const Z_OVERLAY_OFFSET = 100;
export const Z_SELECTION_BADGE = 9500;
export const Z_HAND_ACTIONS_MENU = 200;

// ── Canvas alphas ───────────────────────────────────────────────────────────
// Alpha values only — colour is pulled from the active theme
// (`GameThemeColors.canvas`).
export const BG_ALPHA_IDLE = 0.4;
export const BG_ALPHA_DROP = 0.15;
export const DROP_STROKE_ALPHA = 0.8;
export const DROP_TINT_ALPHA = 0.06;
export const GHOST_STROKE_ALPHA = 0.55;
export const GHOST_FILL_ALPHA = 0.08;

// ── Overlay button alphas ──────────────────────────────────────────────────
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

// ── Overlay labels ─────────────────────────────────────────────────────────
export const OVERLAY_LABEL_TAP = "TAP";
export const OVERLAY_LABEL_UNTAP = "UNTAP";
export const OVERLAY_LABEL_SELECT = "SELECT";

// ── Scryfall card-symbol identifiers ───────────────────────────────────────
export const SYMBOL_TAP = "T";
export const SYMBOL_UNTAP = "Q";
