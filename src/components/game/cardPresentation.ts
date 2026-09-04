import type { CardDto } from "@/protocol/game";
import type { GameThemeColors } from "@/themes/gameTheme";
import {
  deriveCardRailEffects,
  deriveCardRailState,
  type CardRailEffect,
  type CardRailState,
} from "@/components/game/cardRailState";
import { isCreature, isLethalDamage } from "@/components/game/game.utils";

export type CardStatusTone =
  | keyof GameThemeColors["cardStatus"]
  | "neutral"
  | "accent"
  | "danger"
  | "positive"
  | "ring";

export interface CardStatusPresentation {
  id: string;
  label: string;
  tone: CardStatusTone;
}

export interface CardCounterPresentation {
  type: string;
  count: number;
  colorKey: keyof GameThemeColors["counter"];
  iconName?: string;
}

export interface CardStatPresentation {
  power: string;
  toughness: string;
  basePower?: number;
  baseToughness?: number;
  state: "neutral" | "buffed" | "debuffed" | "lethal";
  damage: number;
}

export interface CardCostPresentation {
  id: string;
  label: string;
  cost: string;
}

export interface CardProgressionPresentation {
  rail: CardRailState;
  effects: CardRailEffect[];
}

export interface CardPresentation {
  name: string;
  manaCost: string;
  effectiveManaCost?: string;
  typeLine: string;
  rulesText: string;
  keywords: string[];
  statuses: CardStatusPresentation[];
  counters: CardCounterPresentation[];
  stats: CardStatPresentation | null;
  loyalty: number | null;
  defense: number | null;
  costs: CardCostPresentation[];
  progression: CardProgressionPresentation | null;
}
const LOYALTY_COUNTER_TYPE = "Loyalty";
const DEFENSE_COUNTER_TYPE = "DEFENSE";

const COUNTER_COLOR_KEYS: Record<string, keyof GameThemeColors["counter"]> = {
  P1P1: "p1p1",
  M1M1: "m1m1",
  [LOYALTY_COUNTER_TYPE]: "loyalty",
  Charge: "charge",
  Quest: "quest",
  Study: "study",
  Lore: "lore",
  Age: "age",
  Time: "time",
  Fade: "fade",
  Level: "level",
  Storage: "storage",
  Mining: "mining",
  Brick: "brick",
  Depletion: "depletion",
  Page: "page",
  Shield: "shield",
};

const COUNTER_ICON_NAMES: Record<string, string> = {
  [LOYALTY_COUNTER_TYPE]: "vibrating-shield",
  Charge: "lightning-trio",
  Quest: "scroll-quill",
  Study: "book-aura",
  Lore: "spell-book",
  Age: "hourglass",
  Time: "stopwatch",
  Fade: "ghost",
  Level: "rank-3",
  Storage: "stack",
  Mining: "mining",
  Brick: "brick-wall",
  Depletion: "battery-pack-alt",
  Page: "scroll-unfurled",
  Shield: "shield",
};

export function cardTypeLine(card: CardDto): string {
  const cardTypes = [...card.supertypes, ...card.types].join(" ");
  return card.subtypes.length > 0 ? `${cardTypes} — ${card.subtypes.join(" ")}` : cardTypes;
}

export function counterColorKey(type: string): keyof GameThemeColors["counter"] {
  return COUNTER_COLOR_KEYS[type] ?? "default";
}

export function counterIconName(type: string): string | undefined {
  return COUNTER_ICON_NAMES[type];
}

function deriveStatuses(card: CardDto): CardStatusPresentation[] {
  const statuses: CardStatusPresentation[] = [];
  const add = (id: string, label: string, tone: CardStatusTone) =>
    statuses.push({ id, label, tone });

  if (card.wouldDieInCombat) add("doomed", "Dies in combat", "danger");
  if (card.isAttacking) add("attacking", "Attacking", "danger");
  if (card.summoningSick && isCreature(card)) add("summoning-sick", "Summoning sick", "accent");
  if (card.tapped) add("tapped", "Tapped", "neutral");
  if (card.isCrewed) add("crewed", "Crewed", "positive");
  if (card.phasedOut) add("phased-out", "Phased out", "neutral");
  if (card.exerted) add("exerted", "Exerted", "exerted");
  if (card.isFaceDown) add("face-down", "Face down", "morph");
  if (card.isBestowed) add("bestowed", "Bestowed", "bestow");
  if (card.isTransformed) add("transformed", "Transformed", "transformed");
  if (card.isPlotted) add("plotted", "Plotted", "plotted");
  if (card.isMadnessExiled) add("madness", "Madness", "madness");
  if (card.isWarpExiled) add("warped", "Warped", "warped");
  if (card.isCopy) add("copy", "Copy", "copy");
  if (card.identity.isToken) add("token", "Token", "token");
  if (card.isRingBearer) add("ring-bearer", "Ring-bearer", "ring");
  if (card.foil) add("foil", "Foil", "accent");
  if (card.attachedTo) add("attached", "Attached", "neutral");
  if (card.attachmentIds.length > 0) {
    add("attachments", `Attachments ×${card.attachmentIds.length}`, "neutral");
  }
  if (card.mergedCardIds.length > 0) {
    add("merged", `Merged ×${card.mergedCardIds.length}`, "neutral");
  }

  return statuses;
}

function deriveStats(card: CardDto): CardStatPresentation | null {
  if (!isCreature(card) || card.power == null || card.toughness == null) return null;
  const lethal = isLethalDamage(card);
  const power = Number.parseInt(card.power, 10);
  const toughness = Number.parseInt(card.toughness, 10);
  const buffed =
    (card.basePower != null && power > card.basePower) ||
    (card.baseToughness != null && toughness > card.baseToughness);
  const debuffed =
    (card.basePower != null && power < card.basePower) ||
    (card.baseToughness != null && toughness < card.baseToughness);

  return {
    power: card.power,
    toughness: card.toughness,
    basePower: card.basePower,
    baseToughness: card.baseToughness,
    state: lethal ? "lethal" : buffed ? "buffed" : debuffed ? "debuffed" : "neutral",
    damage: card.damage,
  };
}

function deriveCosts(card: CardDto): CardCostPresentation[] {
  const costs: CardCostPresentation[] = [];
  if (card.flashbackCost)
    costs.push({ id: "flashback", label: "Flashback", cost: card.flashbackCost });
  if (card.kickerCost) costs.push({ id: "kicker", label: "Kicker", cost: card.kickerCost });
  if (card.madnessCost) costs.push({ id: "madness", label: "Madness", cost: card.madnessCost });
  return costs;
}

export function deriveCardPresentation(card: CardDto): CardPresentation {
  const rail = deriveCardRailState(card);
  const isPlaneswalker = card.types.some((type) => type.toLowerCase() === "planeswalker");
  const isBattle = card.types.some((type) => type.toLowerCase() === "battle");
  const loyalty = isPlaneswalker ? (card.counters[LOYALTY_COUNTER_TYPE] ?? null) : null;
  const defense = isBattle ? (card.counters[DEFENSE_COUNTER_TYPE] ?? null) : null;

  return {
    name: card.identity.name,
    manaCost: card.manaCost,
    effectiveManaCost: card.effectiveManaCost,
    typeLine: cardTypeLine(card),
    rulesText: card.text,
    keywords: card.keywords,
    statuses: deriveStatuses(card),
    counters: Object.entries(card.counters)
      .filter(
        ([type, count]) =>
          count > 0 &&
          !(isPlaneswalker && type === LOYALTY_COUNTER_TYPE) &&
          !(isBattle && type === DEFENSE_COUNTER_TYPE),
      )
      .map(([type, count]) => ({
        type,
        count,
        colorKey: counterColorKey(type),
        iconName: counterIconName(type),
      })),
    stats: deriveStats(card),
    loyalty,
    defense,
    costs: deriveCosts(card),
    progression: rail ? { rail, effects: deriveCardRailEffects(card, rail) } : null,
  };
}
