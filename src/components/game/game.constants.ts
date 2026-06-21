/** Phase bar definitions — must match phase_to_step() in src-tauri/src/game_view_dto.rs */
export const PHASES = [
  { id: "untap", label: "Untap", short: "UNT" },
  { id: "upkeep", label: "Upkeep", short: "UP" },
  { id: "draw", label: "Draw", short: "DR" },
  { id: "main1", label: "Main 1", short: "M1" },
  { id: "begin_combat", label: "Begin Combat", short: "BC" },
  { id: "declare_attackers", label: "Attackers", short: "ATK" },
  { id: "declare_blockers", label: "Blockers", short: "BLK" },
  { id: "first_strike_damage", label: "1st Strike", short: "1ST" },
  { id: "combat_damage", label: "Damage", short: "DMG" },
  { id: "end_combat", label: "End Combat", short: "EC" },
  { id: "main2", label: "Main 2", short: "M2" },
  { id: "end", label: "End", short: "END" },
  { id: "cleanup", label: "Cleanup", short: "CL" },
] as const;

export { MANA_LETTERS as MANA_KEYS } from "@/themes/gameTheme";

export const ZONE_COLUMN_RESERVED_PX = 120;

/** Standard MTG card back image, served by Scryfall's canonical backs CDN.
 *  UUID `0aeebaf5-8c7d-4636-9e82-8c27447861f7` is the default `card_back_id`
 *  every single-faced card references. */
export const CARD_BACK_IMAGE_URL =
  "https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg";

export const PROMPT_LABELS: Record<string, string> = {
  ["mulligan"]: "Keep this hand?",
  ["mulliganPutBack"]: "Choose cards to put on bottom",
  ["chooseAction"]: "Play a card or pass priority",
  ["chooseAttackers"]: "Declare attackers",
  ["chooseBlockers"]: "Declare blockers",
  ["chooseBoardTargets"]: "Choose a target",
  ["revealCards"]: "Look at cards",
  ["chooseBoolean"]: "Make a choice",
  ["chooseFromSelection"]: "Choose from options",
  ["scry"]: "Scry: choose cards to put on the bottom",
  ["chooseCards"]: "Choose cards",
  ["payManaCost"]: "Pay mana cost",
  ["chooseColor"]: "Choose a color",
  ["chooseNumber"]: "Choose a number",
  ["chooseDamageAssignmentOrder"]: "Order blockers for damage assignment",
  ["chooseCombatDamageAssignment"]: "Assign combat damage",
  ["reorderCards"]: "Reorder the cards",
  ["gameOver"]: "Game Over",
};

export const CARD_BADGES = {
  exerted: { label: "EXERTED", style: "bg-card-status-exerted/90 text-text-on-tinted" },
  morph: { label: "MORPH", style: "bg-card-status-morph/90 text-text-on-tinted" },
  bestow: { label: "BESTOW", style: "bg-card-status-bestow/90 text-text-on-tinted" },
  token: { label: "TOKEN", style: "bg-card-status-token/90 text-text-on-tinted" },
  transformed: { label: "TRANSFORMED", style: "bg-card-status-transformed/90 text-text-on-tinted" },
  plotted: { label: "PLOTTED", style: "bg-card-status-plotted/90 text-text-on-tinted" },
  madnessExiled: { label: "MADNESS", style: "bg-card-status-madness/90 text-text-on-tinted" },
  warpExiled: { label: "WARPED", style: "bg-card-status-warped/90 text-text-on-tinted" },
  copy: { label: "COPY", style: "bg-card-status-copy/90 text-text-on-tinted" },
} as const;

export const CARD_W = 72;
export const CARD_H = 100;
export const CARD_GAP = 8;

export const COMBAT_STAGE_OPPONENT_SHIFT = 100;

export const RING_ABILITIES: readonly string[] = [
  "Your Ring-bearer is legendary and can't be blocked by creatures with greater power.",
  "Whenever your Ring-bearer attacks, draw a card, then discard a card.",
  "Whenever your Ring-bearer becomes blocked by a creature, that creature's controller sacrifices it at the end of combat.",
  "Whenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life.",
] as const;
