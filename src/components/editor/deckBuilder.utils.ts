import type { DeckCard } from "@/protocol/deck";
import { computeCmc, isLand } from "@/lib/mana";
export { scryfallToDeckCard } from "@/lib/scryfall.utils";

export interface CardGroup {
  key: string;
  card: DeckCard;
  count: number;
}

export function cardPrintingKey(card: DeckCard): string {
  const { name, setCode, cardNumber, foil } = card.identity;
  return `${name.toLowerCase()}::${setCode.toLowerCase()}::${cardNumber.toLowerCase()}::${foil ? "foil" : "nonfoil"}`;
}

export type ViewMode = "list" | "visual" | "stack";

export type GroupByMode = "type" | "cmc" | "color" | "custom";

export type SortMode = "name" | "mana-value" | "quantity" | "owned" | "not-owned";

export const GROUP_BY_OPTIONS: { value: GroupByMode; label: string }[] = [
  { value: "type", label: "Type" },
  { value: "cmc", label: "Mana Value" },
  { value: "color", label: "Color" },
  { value: "custom", label: "Custom Tags" },
];

export const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "mana-value", label: "Mana Value" },
  { value: "quantity", label: "Quantity" },
  { value: "owned", label: "Owned First" },
  { value: "not-owned", label: "Not Owned First" },
];

export interface SectionDefinition {
  id: string;
  label: string;
  filter: (types: string[]) => boolean;
}

export const CMC_BUCKET_LABELS = ["1", "2", "3", "4", "5", "6", "7+"] as const;

export function cmcBucketIndex(card: DeckCard): number | null {
  if (isLand(card.types)) return null;
  const cmc = card.cmc ?? (card.manaCost ? computeCmc(card.manaCost) : undefined);
  if (cmc === undefined || cmc === null) return null;
  return Math.min(Math.max(Math.round(cmc) - 1, 0), 6);
}

export function parseFilterTerms(filter: string): string[] {
  return filter
    .toLowerCase()
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

const TYPE_SECTIONS: Record<string, SectionDefinition> = {
  creatures: { id: "creatures", label: "Creatures", filter: (t) => t.includes("Creature") },
  planeswalkers: {
    id: "planeswalkers",
    label: "Planeswalkers",
    filter: (t) => t.includes("Planeswalker") && !t.includes("Creature"),
  },
  instants: { id: "instants", label: "Instants", filter: (t) => t.includes("Instant") },
  sorceries: { id: "sorceries", label: "Sorceries", filter: (t) => t.includes("Sorcery") },
  enchantments: {
    id: "enchantments",
    label: "Enchantments",
    filter: (t) => t.includes("Enchantment") && !t.includes("Creature"),
  },
  artifacts: {
    id: "artifacts",
    label: "Artifacts",
    filter: (t) => t.includes("Artifact") && !t.includes("Creature"),
  },
  lands: { id: "lands", label: "Lands", filter: (t) => t.includes("Land") },
};

const pick = (...keys: string[]) => keys.map((k) => TYPE_SECTIONS[k]);

export const MAIN_SECTIONS: SectionDefinition[] = pick(
  "creatures",
  "planeswalkers",
  "instants",
  "sorceries",
  "enchantments",
  "artifacts",
  "lands",
);

export const STACK_TYPE_COLS: SectionDefinition[] = pick(
  "creatures",
  "instants",
  "sorceries",
  "enchantments",
  "artifacts",
  "planeswalkers",
  "lands",
);

export const CARD_WIDTH_MAP: Record<number, number> = {
  1: 75,
  2: 95,
  3: 115,
  4: 140,
  5: 170,
  6: 200,
  7: 240,
  8: 280,
};

export const DEFAULT_CARD_SIZE = 6;
export const MAX_CARD_SIZE = 8;

/**
 * Groups cards by name, counting duplicates and sorting by CMC then name.
 */
export function groupCards(cards: DeckCard[]): CardGroup[] {
  const map = new Map<string, CardGroup>();
  for (const card of cards) {
    const key = cardPrintingKey(card);
    const existing = map.get(key);
    if (existing) existing.count++;
    else map.set(key, { key, card, count: 1 });
  }
  return Array.from(map.values()).sort((a, b) => {
    const aCmc = a.card.cmc ?? 0;
    const bCmc = b.card.cmc ?? 0;
    if (aCmc !== bCmc) return aCmc - bCmc;
    return a.card.identity.name.localeCompare(b.card.identity.name);
  });
}

export function sortCardGroups(
  groups: CardGroup[],
  mode: SortMode,
  isOwned: (card: DeckCard) => boolean = () => false,
): CardGroup[] {
  return [...groups].sort((a, b) => {
    if (mode === "owned" || mode === "not-owned") {
      const ownershipDifference = Number(isOwned(b.card)) - Number(isOwned(a.card));
      if (ownershipDifference !== 0) {
        return mode === "owned" ? ownershipDifference : -ownershipDifference;
      }
    }
    if (mode === "quantity" && a.count !== b.count) return b.count - a.count;
    if (mode === "mana-value") {
      const difference = (a.card.cmc ?? 0) - (b.card.cmc ?? 0);
      if (difference !== 0) return difference;
    }
    return a.card.identity.name.localeCompare(b.card.identity.name);
  });
}

/**
 * Exports deck to Arena format (main deck + supplementary sections).
 */
/**
 * Computes section groups for the main deck by filtering cards into type sections.
 */
export function computeSectionGroups(
  cards: DeckCard[],
  sections: SectionDefinition[],
): Array<SectionDefinition & { groups: CardGroup[] }> {
  return sections.map((s) => ({
    ...s,
    groups: groupCards(cards.filter((c) => s.filter(c.types))),
  }));
}

/**
 * Computes "Other" group — cards that don't match any main section.
 */
export function computeOtherGroups(
  cards: DeckCard[],
  sectionGroups: Array<{ groups: CardGroup[] }>,
): CardGroup[] {
  const matchedNames = new Set(
    sectionGroups.flatMap((s) => s.groups.map((g) => g.card.identity.name)),
  );
  return groupCards(cards.filter((c) => !matchedNames.has(c.identity.name)));
}

/**
 * Computes stack-mode columns by grouping cards into type columns (no overlap).
 */
export function computeStackColumns(
  cards: DeckCard[],
  columns: SectionDefinition[],
): Array<SectionDefinition & { groups: CardGroup[] }> {
  const allGroups = groupCards(cards);
  const usedGroups = new Set<string>();
  const cols = columns.map((col) => ({
    ...col,
    groups: allGroups.filter((g) => {
      if (usedGroups.has(g.key)) return false;
      if (col.filter(g.card.types)) {
        usedGroups.add(g.key);
        return true;
      }
      return false;
    }),
  }));
  const otherGroups = allGroups.filter((g) => !usedGroups.has(g.key));
  if (otherGroups.length > 0)
    cols.push({ id: "other", label: "Other", filter: () => false, groups: otherGroups });
  return cols.filter((c) => c.groups.length > 0);
}

const CMC_SECTIONS: SectionDefinition[] = [
  { id: "cmc-0", label: "0", filter: () => false },
  { id: "cmc-1", label: "1", filter: () => false },
  { id: "cmc-2", label: "2", filter: () => false },
  { id: "cmc-3", label: "3", filter: () => false },
  { id: "cmc-4", label: "4", filter: () => false },
  { id: "cmc-5", label: "5", filter: () => false },
  { id: "cmc-6", label: "6", filter: () => false },
  { id: "cmc-7+", label: "7+", filter: () => false },
];

const COLOR_ORDER = ["W", "U", "B", "R", "G"] as const;
const COLOR_NAMES: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

function getCardColorKey(card: DeckCard): string {
  const colors = (card.color ?? "")
    .split("")
    .filter((c) => COLOR_ORDER.includes(c as (typeof COLOR_ORDER)[number]));
  if (colors.length === 0) return "Colorless";
  if (colors.length > 1) return "Multicolor";
  return COLOR_NAMES[colors[0]] ?? "Colorless";
}

function groupByCmc(cards: DeckCard[]): Array<SectionDefinition & { groups: CardGroup[] }> {
  const buckets = new Map<string, DeckCard[]>();
  for (const c of cards) {
    const cmc = c.cmc ?? 0;
    const key = cmc >= 7 ? "cmc-7+" : `cmc-${cmc}`;
    const arr = buckets.get(key) ?? [];
    arr.push(c);
    buckets.set(key, arr);
  }
  return CMC_SECTIONS.map((s) => ({ ...s, groups: groupCards(buckets.get(s.id) ?? []) })).filter(
    (s) => s.groups.length > 0,
  );
}

function groupByColor(cards: DeckCard[]): Array<SectionDefinition & { groups: CardGroup[] }> {
  const colorKeys = ["White", "Blue", "Black", "Red", "Green", "Multicolor", "Colorless"];
  const buckets = new Map<string, DeckCard[]>();
  for (const c of cards) {
    const key = getCardColorKey(c);
    const arr = buckets.get(key) ?? [];
    arr.push(c);
    buckets.set(key, arr);
  }
  return colorKeys
    .map((key) => ({
      id: `color-${key.toLowerCase()}`,
      label: key,
      filter: (() => false) as SectionDefinition["filter"],
      groups: groupCards(buckets.get(key) ?? []),
    }))
    .filter((s) => s.groups.length > 0);
}

function groupByCustomTags(
  cards: DeckCard[],
  customTags: string[] | undefined,
  cardTags: Record<string, string[]> | undefined,
): Array<SectionDefinition & { groups: CardGroup[] }> {
  const tags = customTags ?? [];
  const taggedNames = new Set<string>();
  const result = tags.map((tag) => {
    const groups = getTaggedGroups(tag, cards, cardTags);
    for (const g of groups) taggedNames.add(g.card.identity.name);
    return {
      id: `tag-${tag}`,
      label: tag,
      filter: (() => false) as SectionDefinition["filter"],
      groups,
    };
  });
  const untagged = groupCards(
    cards.filter(
      (c) => !taggedNames.has(c.identity.name.toLowerCase()) && !taggedNames.has(c.identity.name),
    ),
  );
  if (untagged.length > 0) {
    result.push({
      id: "untagged",
      label: "Untagged",
      filter: (() => false) as SectionDefinition["filter"],
      groups: untagged,
    });
  }
  return result.filter((s) => s.groups.length > 0);
}

/**
 * Compute sections based on group-by mode. Returns the same shape as computeSectionGroups.
 */
export function computeGroupedSections(
  cards: DeckCard[],
  mode: GroupByMode,
  customTags?: string[],
  cardTags?: Record<string, string[]>,
): { sections: Array<SectionDefinition & { groups: CardGroup[] }>; otherGroups: CardGroup[] } {
  switch (mode) {
    case "type": {
      const sections = computeSectionGroups(cards, MAIN_SECTIONS);
      const otherGroups = computeOtherGroups(cards, sections);
      return { sections, otherGroups };
    }
    case "cmc":
      return { sections: groupByCmc(cards), otherGroups: [] };
    case "color":
      return { sections: groupByColor(cards), otherGroups: [] };
    case "custom":
      return { sections: groupByCustomTags(cards, customTags, cardTags), otherGroups: [] };
  }
}

/**
 * Compute stack columns based on group-by mode.
 */
export function computeGroupedStackColumns(
  cards: DeckCard[],
  mode: GroupByMode,
  customTags?: string[],
  cardTags?: Record<string, string[]>,
): Array<SectionDefinition & { groups: CardGroup[] }> {
  switch (mode) {
    case "type":
      return computeStackColumns(cards, STACK_TYPE_COLS);
    case "cmc":
      return groupByCmc(cards);
    case "color":
      return groupByColor(cards);
    case "custom":
      return groupByCustomTags(cards, customTags, cardTags);
  }
}

/**
 * Get cards belonging to a specific tag, grouped and sorted.
 */
export function getTaggedGroups(
  tag: string,
  allCards: DeckCard[],
  cardTags: Record<string, string[]> | undefined,
): CardGroup[] {
  const taggedNames = new Set(
    Object.entries(cardTags ?? {})
      .filter(([, tags]) => tags.includes(tag))
      .map(([name]) => name),
  );
  return groupCards(allCards.filter((c) => taggedNames.has(c.identity.name.toLowerCase())));
}
