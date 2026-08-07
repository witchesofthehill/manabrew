import type { CardRulesSummary } from "@/types/manabrew";
import { MANA_LETTERS } from "@/themes/gameTheme";

const MONO_COLOR_CLASSES: Record<string, string> = {
  W: "text-mana-w",
  U: "text-mana-u",
  B: "text-mana-b",
  R: "text-mana-r",
  G: "text-mana-g",
  C: "text-muted-foreground",
};

const MULTI_COLOR_CLASSES: Record<string, string> = {
  WU: "text-sky-400",
  WB: "text-stone-200",
  WR: "text-orange-400",
  WG: "text-lime-400",
  UB: "text-indigo-400",
  UR: "text-fuchsia-400",
  UG: "text-cyan-400",
  BR: "text-rose-400",
  BG: "text-teal-400",
  RG: "text-yellow-400",
  WUB: "text-indigo-300",
  WUR: "text-orange-300",
  WUG: "text-cyan-300",
  WBR: "text-rose-300",
  WBG: "text-lime-300",
  WRG: "text-yellow-300",
  UBR: "text-fuchsia-300",
  UBG: "text-teal-300",
  URG: "text-cyan-300",
  BRG: "text-orange-300",
  WUBR: "text-fuchsia-200",
  WUBG: "text-cyan-200",
  WURG: "text-yellow-200",
  WBRG: "text-orange-200",
  UBRG: "text-emerald-200",
  WUBRG: "text-foreground",
};

export const DECK_NAME_SHADOW_CLASS = "drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]" as const;

export function getDeckColors(cards: Pick<CardRulesSummary, "color" | "manaCost">[]): string[] {
  const seen = new Set<string>();
  for (const card of cards) {
    for (const ch of card.color ?? "") {
      if (MANA_LETTERS.includes(ch as (typeof MANA_LETTERS)[number])) {
        seen.add(ch);
      }
    }
    if (card.manaCost?.includes("{C}")) seen.add("C");
  }
  return MANA_LETTERS.filter((color) => seen.has(color));
}

export function getDeckColorCost(cards: Pick<CardRulesSummary, "color" | "manaCost">[]): string {
  return getDeckColors(cards)
    .map((color) => `{${color}}`)
    .join("");
}

export function getColorsNameClass(colors: string): string {
  const ordered = MANA_LETTERS.filter((color) => colors.includes(color));
  if (ordered.length === 0) return "text-foreground";
  if (ordered.length === 1) return MONO_COLOR_CLASSES[ordered[0]] ?? "text-foreground";

  return MULTI_COLOR_CLASSES[ordered.join("")] ?? "text-foreground";
}

export function getDeckNameColorClass(
  cards: Pick<CardRulesSummary, "color" | "manaCost">[],
  presetColor?: string,
): string {
  if (presetColor) return presetColor;
  return getColorsNameClass(getDeckColors(cards).join(""));
}
