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

/** Width reserved for the Pixi player column on the left of the battlefield. */
export const ZONE_COLUMN_RESERVED_PX = 120;

/** Standard MTG card back image, served by Scryfall's canonical backs CDN.
 *  UUID `0aeebaf5-8c7d-4636-9e82-8c27447861f7` is the default `card_back_id`
 *  every single-faced card references. */
export const CARD_BACK_IMAGE_URL =
  "https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg";

import { PromptType } from "@/types/promptType";

export const PROMPT_LABELS: Record<string, string> = {
  [PromptType.Mulligan]: "Keep this hand?",
  [PromptType.MulliganPutBack]: "Choose cards to put on bottom",
  [PromptType.ChooseAction]: "Play a card or pass priority",
  [PromptType.ChooseAttackers]: "Declare attackers",
  [PromptType.ChooseBlockers]: "Declare blockers",
  [PromptType.ChooseTargetPlayer]: "Choose a target player",
  [PromptType.ChooseTargetCard]: "Choose a target creature",
  [PromptType.ChooseTargetAny]: "Choose a target (player or permanent)",
  [PromptType.ChooseTargetCardFromZone]: "Choose a target card from the zone",
  [PromptType.ChooseTargetSpell]: "Choose a spell on the stack to counter",
  [PromptType.RevealCards]: "Look at cards",
  [PromptType.ChooseMode]: "Choose a mode for the spell",
  [PromptType.ChooseOptionalTrigger]: "An optional ability would trigger",
  [PromptType.PayCostToPreventEffect]: "Pay to prevent this effect?",
  [PromptType.ChooseKicker]: "Pay the kicker cost?",
  [PromptType.ChooseBuyback]: "Pay the buyback cost?",
  [PromptType.ChooseMultikicker]: "Choose multikicker count",
  [PromptType.ChooseReplicate]: "Choose replicate count",
  [PromptType.ChooseAlternativeCost]: "Choose casting option",
  [PromptType.Scry]: "Scry: choose cards to put on the bottom",
  [PromptType.Surveil]: "Surveil: choose cards to send to graveyard",
  [PromptType.Dig]: "Dig: choose cards to take",
  [PromptType.ChooseDiscard]: "Discard cards",
  [PromptType.PayCombatCost]: "Pay attack cost",
  [PromptType.PayManaCost]: "Pay mana cost",
  [PromptType.ChooseColor]: "Choose a color",
  [PromptType.ChooseType]: "Choose a type",
  [PromptType.ChooseNumber]: "Choose a number",
  [PromptType.ChooseCardName]: "Choose a card name",
  [PromptType.ChooseDelve]: "Choose cards to exile for Delve",
  [PromptType.ChooseConvoke]: "Choose creatures to tap for Convoke",
  [PromptType.ChooseImprovise]: "Choose artifacts to tap for Improvise",
  [PromptType.SpecifyManaCombo]: "Choose mana colors",
  [PromptType.ChooseDamageAssignmentOrder]: "Order blockers for damage assignment",
  [PromptType.ChooseCombatDamageAssignment]: "Assign combat damage",
  [PromptType.ChooseCardsForEffect]: "Choose cards for effect",
  [PromptType.ChoosePhyrexian]: "Pay Phyrexian mana with life?",
  [PromptType.ChooseExertAttackers]: "Choose attackers to exert",
  [PromptType.ChooseEnlistAttackers]: "Choose attackers to enlist",
  [PromptType.ReorderLibrary]: "Reorder the top of your library",
  [PromptType.ExploreDecision]: "Explore: put in graveyard or on top?",
  [PromptType.HelpPayAssist]: "Help pay for a spell?",
  [PromptType.GameOver]: "Game Over",
};

/** Card status badge definitions — label + Tailwind color classes */
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

/** Logical footprint of battlefield cards. */
export const CARD_W = 72;
export const CARD_H = 100;
export const CARD_GAP = 8;

export const RING_ABILITIES: readonly string[] = [
  "Your Ring-bearer is legendary and can't be blocked by creatures with greater power.",
  "Whenever your Ring-bearer attacks, draw a card, then discard a card.",
  "Whenever your Ring-bearer becomes blocked by a creature, that creature's controller sacrifices it at the end of combat.",
  "Whenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life.",
] as const;
