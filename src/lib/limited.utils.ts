import { useMemo } from "react";

import type { DraftCard } from "@/types/limited";
import type { Deck, DeckCard } from "@/types/manabrew";
import type { ScryfallCard } from "@/types/scryfall";
import { frontFaceName, parseTypeLine } from "@/lib/scryfall.utils";
import { cardKey, peekCard, useCard, useScryfallStore } from "@/stores/useScryfallStore";

export type LimitedZone = "pool" | "main" | "sideboard";

export interface PoolEntry {
  index: number;
  card: DraftCard;
}

/**
 * Rarity bucket used by the limited UI for grouping/badges. `land` and
 * `token` aren't Scryfall rarity values — they're derived from the card's
 * type line so basics still get their own visual slot instead of clumping
 * inside "Common".
 */
export type UIRarity =
  | "common"
  | "uncommon"
  | "rare"
  | "mythic"
  | "special"
  | "land"
  | "token"
  | "unknown";

export const RARITY_ORDER: Record<UIRarity, number> = {
  mythic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
  special: 4,
  land: 5,
  token: 6,
  unknown: 7,
};

export const RARITY_LABEL: Record<UIRarity, string> = {
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

const RARITY_TOKEN: Partial<Record<UIRarity, RarityToken>> = {
  common: "common",
  uncommon: "uncommon",
  rare: "rare",
  mythic: "mythic",
  special: "special",
  land: "land",
};

export function rarityToken(rarity: UIRarity): RarityToken | null {
  return RARITY_TOKEN[rarity] ?? null;
}

/**
 * Map a Scryfall card onto our internal `UIRarity` enum. Basic-land and
 * token buckets are typed via the type line because Scryfall's `rarity`
 * field always reports basics as `common` and never marks tokens
 * specially. Anything missing a card here falls into `unknown`.
 */
export function effectiveRarity(card: ScryfallCard | null | undefined): UIRarity {
  if (!card) return "unknown";
  const typeLine = card.type_line ?? "";
  if (/\bToken\b/i.test(typeLine)) return "token";
  if (/\bBasic\b.*\bLand\b/i.test(typeLine)) return "land";
  switch (card.rarity) {
    case "common":
      return "common";
    case "uncommon":
      return "uncommon";
    case "rare":
      return "rare";
    case "mythic":
      return "mythic";
    case "special":
    case "bonus":
      return "special";
    default:
      return "unknown";
  }
}

/** Reverse of `refToDeckCard` — used by the limited compare dialog to
 *  re-interpret a saved `Deck` as a draft pool for visualization. */
export function deckCardToDraftCard(card: DeckCard): DraftCard {
  return {
    name: card.name,
    setCode: card.setCode,
    collectorNumber: card.cardNumber,
    foil: card.foil,
  };
}

export function deckMainAsDraftCards(deck: Deck): DraftCard[] {
  return deck.cards.map(deckCardToDraftCard);
}

// 1x1 transparent png — image renderers (<img>, PIXI textures) accept it
// without throwing or 404'ing. Used as a placeholder so a card lookup
// that hasn't resolved yet doesn't propagate `undefined` into renderers
// that demand a uris object.
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

/**
 * Pure conversion from a `DraftCard` identity + the resolved Scryfall
 * entry into the canonical `DeckCard`. The Scryfall fields drive
 * everything visual (mana cost, type line, text, image, layout); the
 * draft-card foil flag is the only piece the engine owns and threads
 * through unchanged.
 *
 * Callers that have a `CardEntry` in hand (DraftCardTile, drag overlay)
 * pass it directly. Callers without one (save flow, gauntlet launch)
 * should resolve a batch via `resolveDeckCards` first instead of feeding
 * `null` in — a `null` here yields placeholder uris that propagate.
 */
export function refToDeckCard(
  ref: DraftCard,
  entry: {
    info: ScryfallCard;
    uris: {
      small: string;
      normal: string;
      large: string;
      png: string;
      art_crop: string;
      border_crop: string;
    };
  } | null,
  idx: number,
): DeckCard {
  const info = entry?.info;
  const typeLine = parseTypeLine(info?.type_line ?? "");
  const isDfc = info?.layout === "transform" || info?.layout === "modal_dfc";
  return {
    id: `pool-${idx}-${ref.setCode}-${ref.collectorNumber}`,
    name: frontFaceName(ref.name),
    setCode: ref.setCode,
    cardNumber: ref.collectorNumber,
    color: (info?.colors ?? []).join(""),
    manaCost: info?.mana_cost ?? "",
    cmc: info?.cmc ?? 0,
    types: typeLine.types,
    subtypes: typeLine.subtypes,
    supertypes: typeLine.supertypes,
    text: info?.oracle_text ?? "",
    layout: info?.layout,
    isDoubleFaced: isDfc,
    foil: ref.foil,
    colorIdentity: info?.color_identity ?? [],
    uris: entry?.uris ?? PLACEHOLDER_URIS,
  };
}

/**
 * Batch-resolve draft-card refs into canonical `DeckCard[]` by reading
 * the Scryfall store (sync cache first, async `getCard` fallback for
 * misses). Used at boundaries that persist or play the deck — save to
 * My Decks, gauntlet match launch — so saved/in-game decks never carry
 * the placeholder PNG or empty rules data.
 */
export async function resolveDeckCards(refs: DraftCard[]): Promise<DeckCard[]> {
  const store = useScryfallStore.getState();
  return Promise.all(
    refs.map(async (ref, idx) => {
      const lookup = { name: ref.name, setCode: ref.setCode, collectorNumber: ref.collectorNumber };
      const key = cardKey(lookup);
      let entry = store.cards[key]?.card ?? null;
      if (!entry) {
        try {
          entry = await store.getCard(lookup);
        } catch {
          entry = null;
        }
      }
      return refToDeckCard(ref, entry, idx);
    }),
  );
}

/**
 * Hook variant for components that need a single ref turned into a
 * `DeckCard`. Returns `null` until the Scryfall store has the entry —
 * callers render a skeleton in that window.
 */
export function useDeckCard(ref: DraftCard, idx: number): DeckCard | null {
  const entry = useCard({
    name: ref.name,
    setCode: ref.setCode,
    collectorNumber: ref.collectorNumber,
  });
  return useMemo(() => (entry ? refToDeckCard(ref, entry, idx) : null), [entry, ref, idx]);
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

/**
 * Group pool entries by rarity. Rarity is now a property of the
 * Scryfall card, not the draft-card identity, so the caller provides a
 * resolver that pulls it from the Scryfall store (typically
 * `effectiveRarity(peekCard(bucket, ref))`).
 */
export function groupByRarity(
  entries: PoolEntry[],
  rarityOf: (ref: DraftCard) => UIRarity,
): Array<{ rarity: UIRarity; entries: PoolEntry[] }> {
  const map = new Map<UIRarity, PoolEntry[]>();
  for (const e of entries) {
    const rarity = rarityOf(e.card);
    const list = map.get(rarity) ?? [];
    list.push(e);
    map.set(rarity, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => RARITY_ORDER[a[0]] - RARITY_ORDER[b[0]])
    .map(([rarity, list]) => ({
      rarity,
      entries: list.sort((a, b) => a.card.name.localeCompare(b.card.name)),
    }));
}

/**
 * Hook wrapper around `groupByRarity` that resolves rarity through the
 * live Scryfall store. Re-groups whenever the bucket gains new entries.
 */
export function useGroupByRarity(
  entries: PoolEntry[],
): Array<{ rarity: UIRarity; entries: PoolEntry[] }> {
  const cache = useScryfallStore((s) => s.cards);
  return useMemo(
    () =>
      groupByRarity(entries, (ref) =>
        effectiveRarity(
          peekCard(cache, {
            name: ref.name,
            setCode: ref.setCode,
            collectorNumber: ref.collectorNumber,
          }),
        ),
      ),
    [entries, cache],
  );
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

/**
 * Synthesize a basic-land entry for the deck builder's "fill manabase"
 * action. Carries only identity — Scryfall will resolve the actual card
 * data when the tile renders. `setCode=""` is the engine's signal that
 * this came from the UI, not from an edition.
 */
export function makeBasicLand(name: BasicLandName, idx: number): DraftCard {
  return {
    name,
    setCode: "",
    collectorNumber: `basic-${name.toLowerCase()}-${idx}`,
  };
}
