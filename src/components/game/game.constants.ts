import type { StepKind } from "@/protocol";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
/** The single UI-side list of turn steps, ordered to match the engine's turn
 *  structure. Ids are protocol `StepKind` values — never restate them elsewhere. */
export const PHASES: readonly {
  id: StepKind;
  label: string;
  short: string;
  combat?: boolean;
}[] = [
  {
    id: "untap",
    get label() {
      return i18n._(msg`Untap`);
    },
    short: "UNT",
  },
  {
    id: "upkeep",
    get label() {
      return i18n._(msg`Upkeep`);
    },
    short: "UP",
  },
  {
    id: "draw",
    get label() {
      return i18n._(msg`Draw`);
    },
    short: "DR",
  },
  {
    id: "main1",
    get label() {
      return i18n._(msg`Main 1`);
    },
    short: "M1",
  },
  {
    id: "combatBegin",
    get label() {
      return i18n._(msg`Begin Combat`);
    },
    short: "BC",
    combat: true,
  },
  {
    id: "combatDeclareAttackers",
    get label() {
      return i18n._(msg`Attackers`);
    },
    short: "ATK",
    combat: true,
  },
  {
    id: "combatDeclareBlockers",
    get label() {
      return i18n._(msg`Blockers`);
    },
    short: "BLK",
    combat: true,
  },
  {
    id: "combatFirstStrikeDamage",
    get label() {
      return i18n._(msg`1st Strike`);
    },
    short: "1ST",
    combat: true,
  },
  {
    id: "combatDamage",
    get label() {
      return i18n._(msg`Damage`);
    },
    short: "DMG",
    combat: true,
  },
  {
    id: "combatEnd",
    get label() {
      return i18n._(msg`End Combat`);
    },
    short: "EC",
    combat: true,
  },
  {
    id: "main2",
    get label() {
      return i18n._(msg`Main 2`);
    },
    short: "M2",
  },
  {
    id: "endOfTurn",
    get label() {
      return i18n._(msg`End`);
    },
    short: "END",
  },
  {
    id: "cleanup",
    get label() {
      return i18n._(msg`Cleanup`);
    },
    short: "CL",
  },
];
export { MANA_LETTERS as MANA_KEYS } from "@/themes/gameTheme";
export const ZONE_COLUMN_RESERVED_PX = 120;
export const ZONE_TILE_KEY = {
  library: "lib",
  graveyard: "gy",
  exile: "ex",
  command: "cmd",
} as const;
export const zoneBadgeId = (zoneKey: string): string => `zone-${zoneKey}`;
export const ZONE_BADGES: Record<
  string,
  {
    icon: string;
    label: string;
  }
> = {
  [ZONE_TILE_KEY.library]: {
    icon: "deck",
    get label() {
      return i18n._(msg`Library`);
    },
  },
  [ZONE_TILE_KEY.graveyard]: {
    icon: "graveyard",
    get label() {
      return i18n._(msg`Graveyard`);
    },
  },
  [ZONE_TILE_KEY.exile]: {
    icon: "exile",
    get label() {
      return i18n._(msg`Exile`);
    },
  },
};
/** Standard MTG card back image, served by Scryfall's canonical backs CDN.
 *  UUID `0aeebaf5-8c7d-4636-9e82-8c27447861f7` is the default `card_back_id`
 *  every single-faced card references. */
export const CARD_BACK_IMAGE_URL =
  "https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg";
export const PROMPT_LABELS: Record<string, string> = {
  get ["mulligan"]() {
    return i18n._(msg`Keep this hand?`);
  },
  get ["mulliganPutBack"]() {
    return i18n._(msg`Choose cards to put on bottom`);
  },
  get ["chooseAction"]() {
    return i18n._(msg`Play a card or pass priority`);
  },
  get ["chooseAttackers"]() {
    return i18n._(msg`Declare attackers`);
  },
  get ["chooseBlockers"]() {
    return i18n._(msg`Declare blockers`);
  },
  get ["chooseBoardTargets"]() {
    return i18n._(msg`Choose a target`);
  },
  get ["revealCards"]() {
    return i18n._(msg`Look at cards`);
  },
  get ["chooseBoolean"]() {
    return i18n._(msg`Make a choice`);
  },
  get ["chooseFromSelection"]() {
    return i18n._(msg`Choose from options`);
  },
  get ["scry"]() {
    return i18n._(msg`Scry: choose cards to put on the bottom`);
  },
  get ["chooseCards"]() {
    return i18n._(msg`Choose cards`);
  },
  get ["payManaCost"]() {
    return i18n._(msg`Pay mana cost`);
  },
  get ["chooseColor"]() {
    return i18n._(msg`Choose a color`);
  },
  get ["chooseNumber"]() {
    return i18n._(msg`Choose a number`);
  },
  get ["chooseDamageAssignmentOrder"]() {
    return i18n._(msg`Order blockers for damage assignment`);
  },
  get ["chooseCombatDamageAssignment"]() {
    return i18n._(msg`Assign combat damage`);
  },
  get ["reorder"]() {
    return i18n._(msg`Reorder the cards`);
  },
  get ["gameOver"]() {
    return i18n._(msg`Game Over`);
  },
};
export const CARD_BADGES = {
  exerted: {
    get label() {
      return i18n._(msg`EXERTED`);
    },
    style: "bg-card-status-exerted/90 text-text-on-tinted",
  },
  morph: {
    get label() {
      return i18n._(msg`MORPH`);
    },
    style: "bg-card-status-morph/90 text-text-on-tinted",
  },
  bestow: {
    get label() {
      return i18n._(msg`BESTOW`);
    },
    style: "bg-card-status-bestow/90 text-text-on-tinted",
  },
  token: {
    get label() {
      return i18n._(msg`TOKEN`);
    },
    style: "bg-card-status-token/90 text-text-on-tinted",
  },
  transformed: {
    get label() {
      return i18n._(msg`TRANSFORMED`);
    },
    style: "bg-card-status-transformed/90 text-text-on-tinted",
  },
  plotted: {
    get label() {
      return i18n._(msg`PLOTTED`);
    },
    style: "bg-card-status-plotted/90 text-text-on-tinted",
  },
  madnessExiled: {
    get label() {
      return i18n._(msg`MADNESS`);
    },
    style: "bg-card-status-madness/90 text-text-on-tinted",
  },
  warpExiled: {
    get label() {
      return i18n._(msg`WARPED`);
    },
    style: "bg-card-status-warped/90 text-text-on-tinted",
  },
  copy: {
    get label() {
      return i18n._(msg`COPY`);
    },
    style: "bg-card-status-copy/90 text-text-on-tinted",
  },
} as const;
export const ACTION_DRAWER_BUMP_EVENT = "actiondrawer:bump";
export const CARD_W = 72;
export const CARD_H = 100;
export const CARD_GAP = 8;
/** Corner radius at CARD_W scale — renderers drawing at other sizes must scale
 *  it proportionally (radius = size * CARD_RADIUS / CARD_W) to match the
 *  printed card corner. */
export const CARD_RADIUS = 6;
export const COMBAT_STAGE_OPPONENT_SHIFT = 100;
export const RING_ABILITIES: readonly string[] = [
  "Your Ring-bearer is legendary and can't be blocked by creatures with greater power.",
  "Whenever your Ring-bearer attacks, draw a card, then discard a card.",
  "Whenever your Ring-bearer becomes blocked by a creature, that creature's controller sacrifices it at the end of combat.",
  "Whenever your Ring-bearer deals combat damage to a player, each opponent loses 3 life.",
] as const;
// Card preview hover-delay slider bounds — shared by the Settings page and the
// in-game board settings modal.
export const HOVER_DELAY_MIN = 100;
export const HOVER_DELAY_MAX = 1500;
export const HOVER_DELAY_STEP = 50;
export const AUTOPASS_DELAY_MIN_MS = 700;
export const AUTOPASS_DELAY_MAX_MS = 1500;
export const TRIGGER_ORDER_PROMPT_TITLE = "Order triggered abilities";
