import { MANA_LETTERS } from "@/themes/gameTheme";
import { ANY_COLOR_LETTERS } from "@/components/game/manaUtils";
import { isLand, type ManaColor } from "@/lib/mana";
import type { ScryfallCard } from "@/types/scryfall";

export interface LimitedManaSource {
  colors: ManaColor[];
  tapped: boolean;
  excluded: string[];
}

const BASIC_TYPES: Record<string, ManaColor> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

export function limitedManaSource(card: ScryfallCard): LimitedManaSource {
  const face = card.card_faces?.[0] ?? card;
  const types = face.type_line ?? "";
  const text = face.oracle_text ?? "";
  const excluded: string[] = [];
  let timingExcluded = false;
  if (!isLand(types)) {
    if (/\badd\b.*(?:\{[WUBRGC]\}|mana)|search your library for.*land|treasure token/i.test(text)) {
      excluded.push("Nonland mana, ramp or tokens require costs and sequencing.");
    }
    if (card.layout === "modal_dfc" && isLand(card.card_faces?.[1]?.type_line)) {
      excluded.push("Back-face land choice is not included in source odds.");
    }
    return { colors: [], tapped: false, excluded };
  }
  if (/\bCreature\b/.test(types)) {
    timingExcluded = true;
    excluded.push("Creature lands require a summoning-sickness model.");
  }
  if (
    /\b(?:if|unless|as long as)\b.*\b(?:enter|enters|tapped)\b|\b(?:enter|enters)\b.*\b(?:if|unless|as long as)\b/i.test(
      text,
    )
  ) {
    timingExcluded = true;
    excluded.push("Conditional entry timing is not modeled.");
  }
  if (/\b(?:doesn't|don't|does not) untap\b/i.test(text)) {
    timingExcluded = true;
    excluded.push("Untapping or entry conditions are not modeled.");
  }
  const tapped = /\benters(?: the battlefield)? tapped\b/i.test(text);
  const colors = new Set<ManaColor>();
  for (const [subtype, color] of Object.entries(BASIC_TYPES)) {
    if (new RegExp(`\\b${subtype}\\b`).test(types)) colors.add(color);
  }
  for (const line of text.split("\n")) {
    if (!/\badd\b/i.test(line) || !line.includes(":")) continue;
    const ability = line.replace(/^\((.*)\)$/, "$1");
    const match = ability.match(
      /^\{T\}: Add (\{[WUBRGC]\}(?:,? (?:or )?\{[WUBRGC]\})*|one mana of any color)\.(.*)$/i,
    );
    if (!match || /spend this mana|only|if|unless|for each|equal to|activate only/i.test(line)) {
      excluded.push("Conditional, restricted or costed mana ability is excluded.");
      continue;
    }
    if (match[1].toLowerCase() === "one mana of any color") {
      for (const color of ANY_COLOR_LETTERS) colors.add(color);
    } else {
      for (const color of MANA_LETTERS) {
        if (match[1].includes(`{${color}}`)) colors.add(color);
      }
    }
  }
  if (timingExcluded) colors.clear();
  if (colors.size === 0 && excluded.length === 0) {
    excluded.push(
      "No supported direct mana ability. Fetching and replacement effects are excluded.",
    );
  }
  return { colors: [...colors], tapped, excluded: [...new Set(excluded)] };
}
