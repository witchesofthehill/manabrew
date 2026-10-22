export interface BasePalette {
  /** Opaque, high-contrast foreground used for icons, strokes, and
   *  reveal / neutral pointer glyphs. Usually a near-white for dark
   *  themes and a near-black for light ones. */
  foreground: string;
  labelMuted: string;
  /** Ghost label colour (card-loading placeholder). Slightly brighter
   *  than `labelMuted`. */
  labelGhost: string;

  placeholderFill: string;
  placeholderStroke: string;
  canvasBackground: string;

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
import { contrastRatio, darken, ensureTextContrast, withAlpha } from "./themeColor";

export const CARD_CHANGE_COLORS = {
  buffed: "#229c3c",
  debuffed: "#bb365d",
  changed: "#1685ad",
  removed: "#b27a18",
} as const;

export const CARD_PRINTING_COLORS = {
  paper: "#e4decb",
  ink: "#17140f",
  frame: "#746c60",
  footer: "#fff",
} as const;

export function buildGameColors(p: BasePalette): GameThemeColorMap {
  const promptForeground = (background: string): string =>
    contrastRatio(p.foreground, background) >= contrastRatio(p.canvasBackground, background)
      ? p.foreground
      : p.canvasBackground;
  const cardInk = promptForeground(p.paper);
  return {
    "activeAction.active": p.amber,

    "promptAction.attackAction": p.red,
    "promptAction.defenseAction": p.promptDefense,
    "promptAction.cancel": p.slate,
    "promptForeground.attackAction": promptForeground(p.red),
    "promptForeground.defenseAction": promptForeground(p.promptDefense),
    "promptForeground.cancel": promptForeground(p.slate),

    "targeting.hostile": withAlpha(p.red, 0.88),
    "targeting.friendly": withAlpha(p.promptDefense, 0.88),

    cardRing: p.amber,
    cardSelection: p.violet,
    "interaction.untap": p.slate,
    "connection.disconnected": p.slate,
    "zone.library": p.paper,
    "zone.graveyard": p.slate,
    "zone.exile": p.purple,
    "zone.command": p.amber,

    "cardPaper.background": p.paper,
    "cardPaper.raised": darken(p.paper, 0.04),
    "cardPaper.ink": cardInk,
    "cardPaper.mutedInk": ensureTextContrast(p.slate, p.paper, cardInk, 4.5),
    "cardPaper.border": p.slate,

    "cardChange.buffed": CARD_CHANGE_COLORS.buffed,
    "cardChange.debuffed": CARD_CHANGE_COLORS.debuffed,
    "cardChange.changed": CARD_CHANGE_COLORS.changed,
    "cardChange.removed": CARD_CHANGE_COLORS.removed,

    "cardPrinting.paper": CARD_PRINTING_COLORS.paper,
    "cardPrinting.ink": CARD_PRINTING_COLORS.ink,
    "cardPrinting.frame": CARD_PRINTING_COLORS.frame,
    "cardPrinting.footer": CARD_PRINTING_COLORS.footer,

    "mana.W": p.manaW,
    "mana.U": p.manaU,
    "mana.B": p.manaB,
    "mana.R": p.manaR,
    "mana.G": p.manaG,
    "mana.C": p.manaC,

    "cardStatus.exerted": p.orange,
    "cardStatus.morph": p.slate,
    "cardStatus.bestow": p.teal,
    "cardStatus.token": p.amber,
    "cardStatus.transformed": p.purple,
    "cardStatus.plotted": p.indigo,
    "cardStatus.madness": p.redDeep,
    "cardStatus.warped": p.cyan,
    "cardStatus.copy": p.sky,
    "cardStatus.choice": p.amber,
    "cardStatus.summoningSick": p.labelGhost,

    textOnTinted: p.foreground,
    textMuted: p.labelMuted,
    textGhost: p.labelGhost,

    "canvas.background": p.canvasBackground,
    "canvas.shadow": "#000000",
    "canvas.neutral": p.foreground,
    "phaseStrip.background": p.placeholderFill,

    "cardPlaceholder.fill": p.placeholderFill,
    "cardPlaceholder.stroke": p.placeholderStroke,

    "pt.neutral": p.slate,
    "pt.lethal": p.red,
    "pt.buffed": p.green,
    "pt.debuffed": p.red,

    // Semantic tokens for non-creature UI states. `poison` is a cooler
    // / more olive sibling of `green` so the infect pip reads as ill
    // rather than as a stat buff.
    success: p.green,
    poison: p.poison,
    life: p.red,

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

    "playerColors.self": p.green,
    "playerColors.opponent1": p.amber,
    "playerColors.opponent2": p.blue,
    "playerColors.opponent3": p.pink,

    "badges.monarch": p.amber,
    "badges.initiative": p.blue,
    "badges.poison": p.poison,
    "badges.energy": p.yellow,
    "badges.commanderDamage": p.red,
    "badges.hand": p.slate,
    "badges.radiation": p.green,
    "badges.cityBlessing": p.amber,
    "badges.enduringStory": p.indigo,
    "badges.ring": "#c98510",
    "badges.speed": p.orange,
    "badges.experience": p.violet,
    "badges.ticket": p.teal,

    "legality.legal": p.green,
    "legality.banned": p.red,
    "legality.restricted": p.yellow,

    "community.accent": p.purple,

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
