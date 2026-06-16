/**
 * Shared helper that turns a preset-specific palette into the 70 game
 * colour keys consumed by `GameThemeColors`. Every preset defines one
 * `BasePalette` (about 25 entries) and spreads the output of
 * `buildGameColors(palette)` into its `gameColors` map.
 *
 * This keeps per-preset theme files short and ensures every preset
 * assigns the same semantic intent to the same base hue — e.g. every
 * theme's "pointer.sacrifice" draws from its palette's `redDeep`, every
 * theme's "pt.buffed" from its `green`, and so on.
 */

export interface BasePalette {
  /** Opaque, high-contrast foreground used for icons, strokes, and
   *  reveal / neutral pointer glyphs. Usually a near-white for dark
   *  themes and a near-black for light ones. */
  foreground: string;
  /** Subdued label colour (empty-zone labels). */
  labelMuted: string;
  /** Ghost label colour (card-loading placeholder). Slightly brighter
   *  than `labelMuted`. */
  labelGhost: string;

  /** Sprite background used while a card image is still loading. */
  placeholderFill: string;
  /** Stroke around the placeholder sprite. */
  placeholderStroke: string;
  /** Canvas backdrop for the Pixi play area. */
  canvasBackground: string;

  /** Core hue set — map each to the nearest match in the preset's
   *  canonical palette. */
  red: string; // hostile, destructive, lethal, counter
  redDeep: string; // sacrifice, loseLife, depletion, madness (deeper red)
  orange: string; // damage, fight, attack, exerted, level
  amber: string; // lore, tap, token, warning-ish warm yellow
  yellow: string; // quest
  green: string; // buff, p1p1, heal-alt
  teal: string; // attach, bestow, storage, untap warm
  cyan: string; // untap, warped, study
  blue: string; // draw, friendly, loyalty
  sky: string; // bounce
  indigo: string; // mill, time, plotted
  violet: string; // discard, charge
  purple: string; // exile, transformed, copy, gainControl
  pink: string; // heal
  slate: string; // destroy, morph, fade, pt-neutral, counter-default
  brown: string; // mining, age, brick
  paper: string; // page (near-white muted paper tone)
  /** Poison-counter / skull tint — cooler / more olive than `green` so
   *  an infect pip reads as "ill" rather than a straight buff. */
  poison: string;

  /** Pass-priority / pass-turn prompt button colour. Typically the
   *  preset's primary cool accent (blue, violet, or green). */
  promptPass: string;
  /** Declare-blockers / defense prompt button colour. Typically a
   *  lighter cool tone (cyan, blue, or teal). Also used for the
   *  friendly-target arrow colour. */
  promptDefense: string;

  /** Mana pip tints. Opaque hexes — consumers apply their own alpha. */
  manaW: string;
  manaU: string;
  manaB: string;
  manaR: string;
  manaG: string;
  manaC: string;
}

import type { GameThemeColorMap } from "./gameTheme";

/**
 * Convert a palette into the full set of `gameColors` entries covering
 * every game-theme token. The return type ensures every key from
 * `GameThemeColors` is present — a missing or misspelled key is a
 * compile error.
 */
export function buildGameColors(p: BasePalette): GameThemeColorMap {
  return {
    // ── Active action indicators ────────────────────────────────────
    "activeAction.priority": p.violet,
    "activeAction.active": p.amber,

    // ── Prompt action buttons ───────────────────────────────────────
    "promptAction.passAction": p.promptPass,
    "promptAction.attackAction": p.red,
    "promptAction.defenseAction": p.promptDefense,
    "promptAction.cancel": p.slate,

    // ── Combat / placement arrows ───────────────────────────────────
    "arrow.attack": rgbaFromHex(p.orange, 0.88),
    "arrow.block": rgbaFromHex(p.red, 0.88),
    "arrow.hostileTarget": rgbaFromHex(p.red, 0.88),
    "arrow.friendlyTarget": rgbaFromHex(p.promptDefense, 0.88),

    // ── Card selection ring ─────────────────────────────────────────
    cardRing: p.amber,

    // ── Targeting pointer colours ────────────────────────────────────
    "pointer.hostile": rgbaFromHex(p.red, 0.88),
    "pointer.friendly": rgbaFromHex(p.blue, 0.88),

    // ── Mana symbol tints ────────────────────────────────────────────
    "mana.W": p.manaW,
    "mana.U": p.manaU,
    "mana.B": p.manaB,
    "mana.R": p.manaR,
    "mana.G": p.manaG,
    "mana.C": p.manaC,

    // ── Card status ring / badge colours ─────────────────────────────
    "cardStatus.exerted": p.orange,
    "cardStatus.morph": p.slate,
    "cardStatus.bestow": p.teal,
    "cardStatus.token": p.amber,
    "cardStatus.transformed": p.purple,
    "cardStatus.plotted": p.indigo,
    "cardStatus.madness": p.redDeep,
    "cardStatus.warped": p.cyan,
    "cardStatus.copy": p.sky,

    // ── Generic text / label colours ─────────────────────────────────
    textOnTinted: p.foreground,
    textMuted: p.labelMuted,
    textGhost: p.labelGhost,

    // ── Canvas-level neutrals ────────────────────────────────────────
    // Shadow stays a physics-black across all presets — dark-mode and
    // light-mode surfaces still drop black shadows.
    "canvas.background": p.canvasBackground,
    "canvas.shadow": "#000000",
    "canvas.neutral": p.foreground,

    // ── Card placeholder ─────────────────────────────────────────────
    "cardPlaceholder.fill": p.placeholderFill,
    "cardPlaceholder.stroke": p.placeholderStroke,

    // ── P/T badge backgrounds ────────────────────────────────────────
    "pt.neutral": p.slate,
    "pt.lethal": p.red,
    "pt.buffed": p.green,
    "pt.debuffed": p.red,

    // ── Generic status signals ───────────────────────────────────────
    // Semantic tokens for non-creature UI states. `poison` is a cooler
    // / more olive sibling of `green` so the infect pip reads as ill
    // rather than as a stat buff.
    success: p.green,
    poison: p.poison,
    life: p.red,

    // ── Counter chip colours ─────────────────────────────────────────
    "counter.default": p.slate,
    "counter.p1p1": p.green,
    "counter.m1m1": p.red,
    "counter.loyalty": p.blue,
    "counter.charge": p.purple,
    "counter.quest": p.yellow,
    "counter.study": p.cyan,
    "counter.lore": p.amber,
    "counter.age": p.brown,
    "counter.time": p.indigo,
    "counter.fade": p.slate,
    "counter.level": p.orange,
    "counter.storage": p.teal,
    "counter.mining": p.brown,
    "counter.brick": p.brown,
    "counter.depletion": p.redDeep,
    "counter.page": p.paper,
    "counter.shield": p.amber,

    // ── Player seat colours ──────────────────────────────────────────
    // Phase strip indicator + turn tint. Seat-to-hue mapping is fixed
    // across presets: self = green, opponents cycle amber → blue →
    // purple. Each preset's palette-native version of those hues keeps
    // the strip visually cohesive with the rest of its theme.
    "playerColors.self": p.green,
    "playerColors.opponent1": p.amber,
    "playerColors.opponent2": p.blue,
    "playerColors.opponent3": p.purple,

    // ── Badge icon colours ───────────────────────────────────────────
    // Tint the status chips rendered next to the mana pool. No fill —
    // the hue stains both the icon and its count. Kept semantically
    // stable across presets (monarch = regal amber, poison = infect,
    // damage = red) so icon meaning stays consistent everywhere.
    "badges.monarch": p.amber,
    "badges.initiative": p.blue,
    "badges.poison": p.poison,
    "badges.energy": p.yellow,
    "badges.commanderDamage": p.red,
    "badges.hand": p.slate,
    "badges.radiation": p.green,
    "badges.cityBlessing": p.amber,
    "badges.ring": "#c98510",
    "badges.speed": p.orange,

    // ── Legality badge colours ──────────────────────────────────────────
    "legality.legal": p.green,
    "legality.banned": p.red,
    "legality.restricted": p.yellow,

    // ── Format badge colours ────────────────────────────────────────────
    // One token per format badge colour key. Each preset maps these to
    // its own palette so format badges feel cohesive with the theme.
    "formatBadge.blue": p.blue,
    "formatBadge.amber": p.amber,
    "formatBadge.emerald": p.green,
    "formatBadge.rose": p.red,
    "formatBadge.slate": p.slate,
    "formatBadge.zinc": p.slate,
    "formatBadge.purple": p.purple,
    "formatBadge.teal": p.teal,
    "formatBadge.orange": p.orange,
    "formatBadge.sky": p.sky,
    "formatBadge.indigo": p.indigo,

    "rarity.common": p.slate,
    "rarity.uncommon": p.slate,
    "rarity.rare": p.amber,
    "rarity.mythic": p.orange,
    "rarity.special": p.purple,
    "rarity.land": p.amber,
  };
}

/** Convert a `#rrggbb` hex to an rgba() string with the given alpha. */
function rgbaFromHex(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
