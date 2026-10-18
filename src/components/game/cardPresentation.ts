import type { CardDto } from "@/protocol/game";
import type { GameThemeColors } from "@/themes/gameTheme";
import type { GameIconName } from "./GameIcon";
import {
  deriveCardRailEffects,
  deriveCardRailState,
  type CardRailEffect,
  type CardRailState,
} from "@/components/game/cardRailState";
import {
  deriveCardChoiceIndicators,
  isCreature,
  isLethalDamage,
} from "@/components/game/game.utils";

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
  iconName?: GameIconName;
  label: string;
  title: string;
  displayCount: number | null;
}
export interface CardStatPresentation {
  power: string;
  toughness: string;
  basePower?: number;
  baseToughness?: number;
  state: "neutral" | "buffed" | "debuffed" | "lethal";
  damage: number;
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
  statuses: CardStatusPresentation[];
  counters: CardCounterPresentation[];
  stats: CardStatPresentation | null;
  loyalty: number | null;
  defense: number | null;
  progression: CardProgressionPresentation | null;
}
const LOYALTY_COUNTER_TYPE = "Loyalty";
const DEFENSE_COUNTER_TYPE = "Defense";
type CounterColorKey = keyof GameThemeColors["counter"];
interface CounterConfig {
  iconName?: GameIconName;
  label: string;
  colorKey: CounterColorKey;
  title: string;
}
const COUNTER_CONFIG: Record<string, CounterConfig> = {
  P1P1: { label: "+1/+1", colorKey: "p1p1", title: "+1/+1" },
  M1M1: { label: "−1/−1", colorKey: "m1m1", title: "−1/−1" },
  Loyalty: {
    iconName: "vibrating-shield",
    label: `Loyalty`,
    colorKey: "loyalty",
    title: `Loyalty`,
  },
  Charge: {
    iconName: "lightning-trio",
    label: `Charge`,
    colorKey: "charge",
    title: `Charge`,
  },
  Quest: {
    iconName: "scroll-quill",
    label: `Quest`,
    colorKey: "quest",
    title: `Quest`,
  },
  Study: {
    iconName: "book-aura",
    label: `Study`,
    colorKey: "study",
    title: `Study`,
  },
  Lore: {
    iconName: "spell-book",
    label: `Lore`,
    colorKey: "lore",
    title: `Lore`,
  },
  Age: {
    iconName: "hourglass",
    label: `Age`,
    colorKey: "age",
    title: `Age`,
  },
  Time: {
    iconName: "stopwatch",
    label: `Time`,
    colorKey: "time",
    title: `Time`,
  },
  Fade: {
    iconName: "ghost",
    label: `Fade`,
    colorKey: "fade",
    title: `Fade`,
  },
  Level: {
    iconName: "rank-3",
    label: `Level`,
    colorKey: "level",
    title: `Level`,
  },
  Storage: {
    iconName: "stack",
    label: `Storage`,
    colorKey: "storage",
    title: `Storage`,
  },
  Mining: {
    iconName: "mining",
    label: `Mining`,
    colorKey: "mining",
    title: `Mining`,
  },
  Brick: {
    iconName: "brick-wall",
    label: `Brick`,
    colorKey: "brick",
    title: `Brick`,
  },
  Depletion: {
    iconName: "battery-pack-alt",
    label: `Depletion`,
    colorKey: "depletion",
    title: `Depletion`,
  },
  Page: {
    iconName: "scroll-unfurled",
    label: `Page`,
    colorKey: "page",
    title: `Page`,
  },
  Shield: {
    iconName: "round-shield",
    label: `Shield`,
    colorKey: "shield",
    title: `Shield`,
  },
};
export function getCounterConfig(type: string): CounterConfig {
  return (
    COUNTER_CONFIG[type] ?? {
      label: type.slice(0, 3),
      colorKey: "default",
      title: type,
    }
  );
}
export function counterBadgePresentation(type: string, count: number): CardCounterPresentation {
  const config = getCounterConfig(type);
  const sign = type === "P1P1" ? "+" : type === "M1M1" ? "−" : null;
  return {
    ...config,
    type,
    count,
    label: sign ? `${sign}${count}/${sign}${count}` : config.label,
    displayCount: sign || count <= 1 ? null : count,
  };
}
export function cardTypeLine(card: CardDto): string {
  const cardTypes = [...card.supertypes, ...card.types].join(" ");
  return card.subtypes.length > 0 ? `${cardTypes} — ${card.subtypes.join(" ")}` : cardTypes;
}
export function counterColorKey(type: string): keyof GameThemeColors["counter"] {
  return getCounterConfig(type).colorKey;
}
export function counterIconName(type: string): string | undefined {
  return getCounterConfig(type).iconName;
}
function deriveStatuses(card: CardDto): CardStatusPresentation[] {
  const statuses: CardStatusPresentation[] = [];
  const add = (id: string, label: string, tone: CardStatusTone) =>
    statuses.push({ id, label, tone });
  if (card.wouldDieInCombat) add("doomed", "Dies in combat", "danger");
  if (card.isAttacking) add("attacking", "Attacking", "danger");
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
  if (card.attachedTo) add("attached", "Attached", "neutral");
  if (card.attachmentIds.length > 0) {
    add("attachments", `Attachments ×${card.attachmentIds.length}`, "neutral");
  }
  if (card.mergedCardIds.length > 0) {
    add("merged", `Merged ×${card.mergedCardIds.length}`, "neutral");
  }
  for (const choice of deriveCardChoiceIndicators(card)) {
    add(`choice-${choice.key}`, choice.description, "choice");
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

export function replaceCardName(text: string, name: string): string {
  return text.includes("CARDNAME") ? text.replace(/CARDNAME/g, name) : text;
}

export function deriveCardPresentation(card: CardDto & { zoneId?: string }): CardPresentation {
  const rail = deriveCardRailState(card);
  const isPlaneswalker = card.types.some((type) => type.toLowerCase() === "planeswalker");
  const isBattle = card.types.some((type) => type.toLowerCase() === "battle");
  const emptyCounterValue = card.zoneId === "battlefield" ? 0 : null;
  const loyalty = isPlaneswalker
    ? (card.counters[LOYALTY_COUNTER_TYPE] ?? emptyCounterValue)
    : null;
  const defense = isBattle ? (card.counters[DEFENSE_COUNTER_TYPE] ?? emptyCounterValue) : null;
  return {
    name: card.identity.name,
    manaCost: card.manaCost,
    effectiveManaCost: card.effectiveManaCost,
    typeLine: cardTypeLine(card),
    rulesText: replaceCardName(card.text, card.identity.name),
    statuses: deriveStatuses(card),
    counters: Object.entries(card.counters)
      .filter(
        ([type, count]) =>
          count > 0 &&
          !(isPlaneswalker && type === LOYALTY_COUNTER_TYPE) &&
          !(isBattle && type === DEFENSE_COUNTER_TYPE),
      )
      .map(([type, count]) => counterBadgePresentation(type, count)),
    stats: deriveStats(card),
    loyalty,
    defense,
    progression: rail ? { rail, effects: deriveCardRailEffects(card, rail) } : null,
  };
}
