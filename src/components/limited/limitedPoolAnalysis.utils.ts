import { countColorPips, isLand, type ManaColor } from "@/lib/mana";
import { countManaPips } from "@/lib/limited.utils";
import { MANA_LETTERS } from "@/themes/gameTheme";
import { peekCard, type ScryfallEntry } from "@/stores/useScryfallStore";
import type { DraftCard } from "@/types/limited";
import { limitedManaSource, type LimitedManaSource } from "@/components/limited/limitedManaSources";
import type {
  LimitedRole,
  LimitedRoleOverrides,
} from "@/components/limited/useLimitedAnalysisStore";

export const LIMITED_ROLE_LABELS: Record<LimitedRole, string> = {
  creature: "Creature",
  interaction: "Interaction",
  fixing: "Fixing",
};
export const LIMITED_ROLES = Object.keys(LIMITED_ROLE_LABELS) as LimitedRole[];
export interface AnalyzedLimitedCard {
  card: DraftCard;
  known: boolean;
  land: boolean;
  manaValue: number;
  cost: string;
  roles: Record<LimitedRole, boolean>;
  source: LimitedManaSource;
  requirements: Record<ManaColor, number>;
  alternativeCost: boolean;
}

export function analyzeLimitedCards(
  cards: DraftCard[],
  cache: Record<string, ScryfallEntry>,
  overrides: LimitedRoleOverrides,
): AnalyzedLimitedCard[] {
  return cards.map((card) => {
    const metadata = peekCard(cache, {
      name: card.name,
      setCode: card.setCode,
      cardNumber: card.cardNumber,
    });
    const face = metadata?.card_faces?.[0] ?? metadata;
    const types = face?.type_line ?? "";
    const text =
      metadata?.card_faces?.map((entry) => entry.oracle_text ?? "").join("\n") ??
      metadata?.oracle_text ??
      "";
    const cost = face?.mana_cost ?? "";
    const land = isLand(types);
    const source = metadata
      ? limitedManaSource(metadata)
      : { colors: [], tapped: false, excluded: [] };
    const producedPips = countColorPips((text.match(/\bAdd [^.\n]+/gi) ?? []).join(" "));
    const roles = {
      creature: /\bCreature\b/.test(types),
      interaction:
        /\b(?:destroy|exile|counter) (?:up to [^.]* )?(?:target|all|each)|return (?:target|all|each) [^.]* to (?:its|their|the) owners?['’]s? hand|gets? -\d+\/-\d+|deals? [^.]*damage to (?:any target|target (?:creature|planeswalker))|(?:can't|cannot) (?:attack|block)|loses? all abilities/i.test(
          text,
        ),
      fixing:
        source.colors.filter((color) => color !== "C").length > 1 ||
        MANA_LETTERS.filter((color) => color !== "C" && producedPips[color] > 0).length > 1 ||
        /(?:add|mana)[^.]*any color|search your library for [^.]*land|treasure token/i.test(text),
      ...overrides[card.id],
    };
    const requirements = countColorPips(cost.replace(/\{[^}]*\/[^}]*\}/g, ""));
    return {
      card,
      known: !!metadata,
      land,
      roles,
      cost,
      source,
      requirements,
      manaValue: metadata?.cmc ?? 0,
      alternativeCost: /\{[^}]*\/|\{[XYZS]\}|\b(?:Convoke|Delve|Affinity|Improvise)\b/i.test(
        `${cost} ${text}`,
      ),
    };
  });
}

export function summarizeLimitedCards(cards: AnalyzedLimitedCard[]) {
  const known = cards.filter((card) => card.known);
  const creatures = known.filter((card) => card.roles.creature);
  const curve = Array.from(
    { length: 7 },
    (_, manaValue) =>
      creatures.filter((card) => Math.min(6, Math.floor(card.manaValue)) === manaValue).length,
  );
  const requirements = Object.fromEntries(
    MANA_LETTERS.map((color) => [
      color,
      known.filter((card) => !card.land).reduce((sum, card) => sum + card.requirements[color], 0),
    ]),
  ) as Record<ManaColor, number>;
  const alternatives = Object.fromEntries(
    MANA_LETTERS.map((color) => [
      color,
      known
        .filter((card) => !card.land)
        .reduce((sum, card) => sum + countManaPips(card.cost, color) - card.requirements[color], 0),
    ]),
  ) as Record<ManaColor, number>;
  const sources = Object.fromEntries(
    MANA_LETTERS.map((color) => [
      color,
      known.filter((card) => card.source.colors.includes(color)).length,
    ]),
  ) as Record<ManaColor, number>;
  return {
    total: cards.length,
    missing: cards.length - known.length,
    creatures: creatures.length,
    interaction: known.filter((card) => card.roles.interaction).length,
    fixing: known.filter((card) => card.roles.fixing).length,
    lands: known.filter((card) => card.land).length,
    physicalSources: known.filter((card) => card.source.colors.length > 0).length,
    excluded: known.filter((card) => card.source.excluded.length > 0),
    curve,
    requirements,
    alternatives,
    sources,
  };
}
