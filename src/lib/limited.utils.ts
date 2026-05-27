import type { DraftCard } from "@/types/limited";
import type { Deck, DeckCard } from "@/types/manabrew";
import { frontFaceName } from "@/lib/scryfall.utils";

export type LimitedZone = "pool" | "main" | "sideboard";

export interface PoolEntry {
  index: number;
  card: DraftCard;
}

export const RARITY_ORDER: Record<DraftCard["rarity"], number> = {
  mythic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
  special: 4,
  land: 5,
  token: 6,
  unknown: 7,
};

export const RARITY_LABEL: Record<DraftCard["rarity"], string> = {
  mythic: "Mythic",
  rare: "Rare",
  uncommon: "Uncommon",
  common: "Common",
  special: "Special",
  land: "Land",
  token: "Token",
  unknown: "Other",
};

export function manaPipPattern(letter: string): RegExp {
  return new RegExp(`\\{[^}]*${letter}[^}]*\\}`, "g");
}

export function countManaPips(cost: string, letter: string): number {
  return cost.match(manaPipPattern(letter))?.length ?? 0;
}

export type RarityToken = keyof import("@/themes/gameTheme").GameThemeColors["rarity"];

const RARITY_TOKEN: Partial<Record<DraftCard["rarity"], RarityToken>> = {
  common: "common",
  uncommon: "uncommon",
  rare: "rare",
  mythic: "mythic",
  special: "special",
  land: "land",
};

export function rarityToken(rarity: DraftCard["rarity"]): RarityToken | null {
  return RARITY_TOKEN[rarity] ?? null;
}

/** Reverse of `draftCardToManaBrew` — used by the limited compare dialog to
 *  re-interpret a saved `Deck` as a draft pool for visualization. Rarity is
 *  unknown because saved decks don't carry it. */
export function deckCardToDraftCard(card: DeckCard): DraftCard {
  return {
    name: card.name,
    setCode: card.setCode,
    collectorNumber: card.cardNumber,
    rarity: "unknown",
    colors: card.colorIdentity,
    isDoubleFaced: card.isDoubleFaced,
    foil: card.foil,
  };
}

export function deckMainAsDraftCards(deck: Deck): DraftCard[] {
  return deck.cards.map(deckCardToDraftCard);
}

// 1x1 transparent png — image renderers (<img>, PIXI textures) accept it
// without throwing or 404'ing. Used as a placeholder until the Scryfall
// store catches up; consumers that need a real image (DraftCardTile, deck
// thumbnails) gate on `uris` separately and show a skeleton in the meantime.
const PLACEHOLDER_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PLACEHOLDER_URIS = {
  small: PLACEHOLDER_URI,
  normal: PLACEHOLDER_URI,
  large: PLACEHOLDER_URI,
  png: PLACEHOLDER_URI,
  art_crop: PLACEHOLDER_URI,
  border_crop: PLACEHOLDER_URI,
};

export function draftCardToManaBrew(dc: DraftCard, idx: number): DeckCard {
  return {
    id: `pool-${idx}-${dc.setCode}-${dc.collectorNumber}`,
    name: frontFaceName(dc.name),
    setCode: dc.setCode,
    cardNumber: dc.collectorNumber,
    color: "",
    manaCost: "",
    cmc: 0,
    types: [],
    subtypes: [],
    supertypes: [],
    text: "",
    isDoubleFaced: dc.isDoubleFaced,
    foil: dc.foil,
    colorIdentity: dc.colors ?? [],
    uris: dc.uris ?? PLACEHOLDER_URIS,
  };
}

export function indexPool(pool: DraftCard[]): PoolEntry[] {
  return pool.map((card, index) => ({ index, card }));
}

export function unusedIndices(poolSize: number, main: number[], sideboard: number[]): number[] {
  const used = new Set([...main, ...sideboard]);
  const out: number[] = [];
  for (let i = 0; i < poolSize; i++) if (!used.has(i)) out.push(i);
  return out;
}

export function groupByRarity(
  entries: PoolEntry[],
): Array<{ rarity: DraftCard["rarity"]; entries: PoolEntry[] }> {
  const map = new Map<DraftCard["rarity"], PoolEntry[]>();
  for (const e of entries) {
    const list = map.get(e.card.rarity) ?? [];
    list.push(e);
    map.set(e.card.rarity, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => RARITY_ORDER[a[0]] - RARITY_ORDER[b[0]])
    .map(([rarity, list]) => ({
      rarity,
      entries: list.sort((a, b) => a.card.name.localeCompare(b.card.name)),
    }));
}

/** Group entries by name (count duplicates), sorted alphabetically. */
export function groupByName(entries: PoolEntry[]): Array<{ name: string; entries: PoolEntry[] }> {
  const map = new Map<string, PoolEntry[]>();
  for (const e of entries) {
    const list = map.get(e.card.name) ?? [];
    list.push(e);
    map.set(e.card.name, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, list]) => ({ name, entries: list }));
}

export const BASIC_LAND_NAMES = ["Plains", "Island", "Swamp", "Mountain", "Forest"] as const;
export type BasicLandName = (typeof BASIC_LAND_NAMES)[number];

const BASIC_LAND_NAME_SET: Set<string> = new Set([
  ...BASIC_LAND_NAMES,
  "Wastes",
  "Snow-Covered Plains",
  "Snow-Covered Island",
  "Snow-Covered Swamp",
  "Snow-Covered Mountain",
  "Snow-Covered Forest",
]);

export interface DeckValidationIssue {
  /** Stable code for tests / styling. */
  kind: "main_too_small" | "main_too_large" | "too_many_copies";
  message: string;
}

export function validateLimitedDeck(
  main: DraftCard[],
  sideboard: DraftCard[],
  targetMainSize: number,
  maxCopies = 4,
): DeckValidationIssue[] {
  const issues: DeckValidationIssue[] = [];
  if (main.length < targetMainSize) {
    issues.push({
      kind: "main_too_small",
      message: `Main deck has ${main.length} cards, needs ${targetMainSize}.`,
    });
  }
  // Some formats cap main + sideboard at a hard ceiling; for limited
  // we only flag a vastly oversized main as a soft warning.
  if (main.length > targetMainSize + 20) {
    issues.push({
      kind: "main_too_large",
      message: `Main deck has ${main.length} cards (target ${targetMainSize}).`,
    });
  }
  const counts = new Map<string, number>();
  for (const card of [...main, ...sideboard]) {
    if (BASIC_LAND_NAME_SET.has(card.name)) continue;
    counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
  }
  for (const [name, n] of counts) {
    if (n > maxCopies) {
      issues.push({
        kind: "too_many_copies",
        message: `${n}× ${name} (max ${maxCopies}).`,
      });
    }
  }
  return issues;
}

const WUBRG = ["W", "U", "B", "R", "G"] as const;
export type ManaLetter = (typeof WUBRG)[number];

export const BASIC_LAND_MANA: Record<BasicLandName, ManaLetter> = Object.fromEntries(
  BASIC_LAND_NAMES.map((name, i) => [name, WUBRG[i]]),
) as Record<BasicLandName, ManaLetter>;

/** Synthesize a basic-land entry — used when the player wants to fill
 *  out the manabase with cards the pool doesn't include. */
export function makeBasicLand(name: BasicLandName, idx: number): DraftCard {
  return {
    name,
    setCode: "",
    collectorNumber: `basic-${name.toLowerCase()}-${idx}`,
    rarity: "land",
  };
}
