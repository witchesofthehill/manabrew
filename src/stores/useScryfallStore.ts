import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {
  fetchCardsBySet,
  fetchImageElement,
  fetchSets,
  getCardById,
  getCardByName,
  getCardBySetAndNumber,
  getRulings,
} from "@/api/scryfall";
import type {
  ScryfallCard,
  ScryfallImageUris,
  ScryfallRulingsResponse,
  ScryfallSet,
} from "@/types/scryfall";
import type { DeckCard } from "@/types/manabrew";
import { Texture, ImageSource } from "pixi.js";
import { useEffect, useState } from "react";
import { frontFaceName } from "@/lib/scryfall.utils";

export interface ScryfallCardLookup {
  id?: string;
  name?: string;
  setCode?: string;
  collectorNumber?: string;
  cardNumber?: string;
}

type CardEntry = {
  info: ScryfallCard;
  texture: Texture;
  uris: ScryfallImageUris;
};

interface TokenArchive {
  schemaVersion: number;
  tokens: DeckCard[];
}

interface TokenArchiveIndex {
  tokens: DeckCard[];
  byId: Map<string, DeckCard>;
  bySetAndNumber: Map<string, DeckCard>;
  byName: Map<string, DeckCard>;
}

export interface ScryfallEntry {
  card?: CardEntry;
  pendingPromise?: Promise<CardEntry>;
}

interface ScryfallState {
  _fetchCardLookup: (lookup: ScryfallCardLookup) => Promise<CardEntry>;
  cards: Record<string, ScryfallEntry>;
  sets: ScryfallSet[];
  /** Lowercased set codes whose card metadata has already been hydrated.
   *  Object-shaped (not `Set`) so immer can produce drafts without the
   *  MapSet plugin. */
  hydratedSets: Record<string, true>;
  getCard: (lookup: ScryfallCardLookup) => Promise<CardEntry>;
  getCardTexture: (card: DeckCard) => Promise<Texture>;
  updatePrinting: (card: ScryfallCard) => CardEntry;
  invalidateCard: (name: string) => void;
  getRulings: (card: { rulings_uri: string }) => Promise<ScryfallRulingsResponse>;

  // Used for draft mode, where you think in terms of sets and not decks
  prefetchSet: (setCode: string) => Promise<void>;
}

/**
 * The single, canonical cache key for any card lookup. Every store
 * read, write, mirror, peek, and texture lookup goes through here —
 * if you find yourself building a `set:X::cn:Y` / `name:X` / `id:X`
 * string by hand, you're holding it wrong.
 *
 * Prefers `set:X::cn:Y` because every in-deck card, every engine
 * DTO, and every Scryfall response carries set + collector. Name is
 * the entry-point fallback (search box, "add by name"); id is the
 * last resort for raw Scryfall references.
 */
export function cardKey(lookup: ScryfallCardLookup): string {
  const set = lookup.setCode?.toLowerCase();
  const cn = (lookup.collectorNumber ?? lookup.cardNumber)?.toLowerCase();
  if (set && cn) return `set:${set}::cn:${cn}`;
  if (lookup.name) return `name:${lookup.name.toLowerCase()}`;
  if (lookup.id) return `id:${lookup.id}`;
  throw new Error("cardKey requires setCode+collectorNumber, name, or id");
}

/**
 * Mirror keys to write a fetched entry under, so a subsequent lookup
 * by either set+cn or name lands on the same printing. Tokens are
 * not mirrored under their name — many distinct tokens share the
 * same name and a name-only lookup would arbitrarily collapse them.
 */
function mirrorCardKeys(entry: ScryfallEntry): string[] {
  const info = entry.card?.info;
  if (!info) return [];
  const keys: string[] = [];
  if (info.set && info.collector_number) {
    keys.push(cardKey({ setCode: info.set, collectorNumber: info.collector_number }));
  }
  const isToken = info.layout?.includes("token");
  if (!isToken && info.name) keys.push(cardKey({ name: info.name }));
  return keys;
}

/**
 * Synchronous cache read — returns the cached `ScryfallCard` info for a
 * given lookup, or `null` if not yet fetched. Callers that want reactive
 * updates should subscribe to `useScryfallStore(s => s.cards)` and pass
 * that bucket in. Use this when you have many cards to inspect in a
 * `useMemo` and can't call `useCard` per row.
 */
export function peekCard(
  bucket: Record<string, ScryfallEntry>,
  lookup: ScryfallCardLookup,
): ScryfallCard | null {
  try {
    return bucket[cardKey(lookup)]?.card?.info ?? null;
  } catch {
    return null;
  }
}

async function fetchScryfallCard(lookup: ScryfallCardLookup): Promise<ScryfallCard> {
  if (lookup.id) {
    return getCardById(lookup.id);
  }
  const cn = lookup.collectorNumber ?? lookup.cardNumber;
  if (lookup.setCode && cn) {
    return getCardBySetAndNumber(lookup.setCode, cn);
  }
  if (!lookup.name) {
    throw new Error("Scryfall lookup requires a name or id");
  }
  return getCardByName(lookup.name, lookup.setCode);
}

function normalizeTokenId(id: string): string {
  return id.startsWith("token:") ? id.slice("token:".length) : id;
}

let tokenArchivePromise: Promise<TokenArchiveIndex> | null = null;
let loadedTokenArchive: TokenArchiveIndex | null = null;

async function loadTokenArchive(): Promise<TokenArchiveIndex> {
  tokenArchivePromise ??= fetch("/token_archive.json")
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to load token archive: ${response.status}`);
      return response.json() as Promise<TokenArchive>;
    })
    .then((archive) => {
      // The archive stores DFC-style names (e.g. "Angel // Demon"); the
      // engine and asDeckCard see only the front face, so collapse
      // every token name here before indexing.
      const tokens = archive.tokens.map((t) => ({ ...t, name: frontFaceName(t.name) }));
      const byId = new Map<string, DeckCard>();
      const bySetAndNumber = new Map<string, DeckCard>();
      const byName = new Map<string, DeckCard>();
      for (const token of tokens) {
        byId.set(token.id, token);
        byId.set(normalizeTokenId(token.id), token);
        bySetAndNumber.set(
          cardKey({ setCode: token.setCode, collectorNumber: token.cardNumber }),
          token,
        );
        const lower = token.name.toLowerCase();
        if (!byName.has(lower)) byName.set(lower, token);
        const withSuffix = `${lower} token`;
        if (!byName.has(withSuffix)) byName.set(withSuffix, token);
      }
      const index = { tokens, byId, bySetAndNumber, byName };
      loadedTokenArchive = index;
      return index;
    });
  return tokenArchivePromise;
}

export async function prefetchTokenArchive() {
  return loadTokenArchive().then(() => undefined);
}

export function peekAllArchivedTokens(): DeckCard[] {
  if (!loadedTokenArchive) return [];
  const byName = new Map<string, DeckCard>();
  for (const token of loadedTokenArchive.tokens) {
    const key = token.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, token);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function peekArchivedToken(
  lookup: { name?: string; setCode?: string; cardNumber?: string } = {},
): DeckCard | null {
  if (!loadedTokenArchive) return null;
  if (lookup.setCode && lookup.cardNumber) {
    const hit = loadedTokenArchive.bySetAndNumber.get(
      cardKey({ setCode: lookup.setCode, collectorNumber: lookup.cardNumber }),
    );
    if (hit) return hit;
  }
  if (lookup.name) {
    return loadedTokenArchive.byName.get(lookup.name.toLowerCase()) ?? null;
  }
  return null;
}

async function lookupArchivedToken(lookup: ScryfallCardLookup): Promise<DeckCard | null> {
  if (lookup.id) {
    const archive = await loadTokenArchive();
    return archive.byId.get(lookup.id) ?? null;
  }
  if (lookup.setCode && lookup.collectorNumber) {
    const archive = await loadTokenArchive();
    return archive.bySetAndNumber.get(cardKey(lookup)) ?? null;
  }
  return null;
}

function tokenToScryfallCard(token: DeckCard): ScryfallCard {
  const scryfallId = normalizeTokenId(token.id);
  const typeLine = [...token.supertypes, ...token.types].join(" ");
  const subtypeLine = token.subtypes.length > 0 ? ` — ${token.subtypes.join(" ")}` : "";
  return {
    id: scryfallId,
    oracle_id: scryfallId,
    name: token.name,
    lang: "en",
    released_at: "",
    uri: "",
    scryfall_uri: "",
    layout: token.layout ?? "token",
    highres_image: true,
    image_status: "highres_scan",
    image_uris: token.uris,
    mana_cost: token.manaCost,
    cmc: token.cmc,
    type_line: `${typeLine}${subtypeLine}`,
    oracle_text: token.text,
    power: token.power,
    toughness: token.toughness,
    colors: token.color ? token.color.split("") : [],
    color_identity: token.colorIdentity,
    keywords: token.keywords ?? [],
    legalities: {},
    games: ["paper"],
    reserved: false,
    foil: false,
    nonfoil: true,
    finishes: ["nonfoil"],
    oversized: false,
    promo: false,
    reprint: false,
    variation: false,
    set_id: "",
    set: token.setCode,
    set_name: token.setCode.toUpperCase(),
    set_type: "token",
    set_uri: "",
    set_search_uri: "",
    scryfall_set_uri: "",
    rulings_uri: "",
    prints_search_uri: "",
    collector_number: token.cardNumber,
    digital: false,
    rarity: "common",
    card_back_id: "",
    artist: "",
    artist_ids: [],
    illustration_id: "",
    border_color: "black",
    frame: "",
    full_art: false,
    textless: false,
    booster: false,
    story_spotlight: false,
    prices: {},
    related_uris: {},
    purchase_uris: {},
  };
}

export async function getArchivedTokenPrints(name: string): Promise<ScryfallCard[]> {
  const archive = await loadTokenArchive();
  const lowerName = name.toLowerCase();
  return archive.tokens
    .filter((token) => token.name.toLowerCase() === lowerName)
    .map(tokenToScryfallCard);
}

export const chooseImageUrisForCard = (
  info: ScryfallCard,
  { frontOnly }: { frontOnly: boolean },
): ScryfallImageUris | null => {
  if (info.image_uris) {
    return info.image_uris; // TODO: which one?
  }
  if (info.card_faces) {
    for (const f of info.card_faces) {
      if (f.name && f.image_uris && (!frontOnly || f.image_uris.small.includes("/front/"))) {
        return f.image_uris;
      }
    }
  }
  return null; //TODO:
};

const createTextureFromImage = (img: HTMLImageElement): Texture => {
  const source = new ImageSource({ resource: img });
  const tex = new Texture({ source });
  return tex;
};

/** Pixi textures aren't React state — keep them in a plain module-level
 *  map keyed by print identity. Survives across game sessions; immutable
 *  per entry. */
const textureCache = new Map<string, Texture>();
const pendingTexturePromises = new Map<string, Promise<Texture>>();

export const useScryfallStore = create<ScryfallState>()(
  devtools(
    immer((set, get) => ({
      cards: {},
      hydratedSets: {},
      _fetchCardLookup: async (lookup) => {
        const key = cardKey(lookup);
        const archivedToken = await lookupArchivedToken(lookup);
        const card = archivedToken
          ? tokenToScryfallCard(archivedToken)
          : await fetchScryfallCard(lookup);

        const uris = chooseImageUrisForCard(card, { frontOnly: true });
        if (!uris) {
          throw new Error("Couldn't find a texture url for: " + JSON.stringify(lookup));
        }

        const entry: ScryfallEntry = {
          card: { info: card, texture: Texture.EMPTY, uris },
        };
        const newId = entry.card?.info?.id;
        set((state) => {
          state.cards[key] = entry;
          for (const k of mirrorCardKeys(entry)) {
            // Preserve pinnings (e.g. from `updatePrinting`) by only
            // overwriting empty slots or slots already pointing at the
            // same Scryfall printing.
            const existingId = state.cards[k]?.card?.info?.id;
            if (existingId == null || existingId === newId) state.cards[k] = entry;
          }
        });
        return entry.card!;
      },
      getCard: async (lookup) => {
        const key = cardKey(lookup);
        const existing = get().cards[key];
        if (existing?.card) return existing.card;
        if (existing?.pendingPromise) return existing.pendingPromise;

        const { _fetchCardLookup } = get();
        const pendingPromise = _fetchCardLookup(lookup);
        set((state) => {
          state.cards[key] = { pendingPromise };
        });
        return pendingPromise;
      },
      getCardTexture: async (deckCard) => {
        const key = cardKey({
          setCode: deckCard.setCode,
          collectorNumber: deckCard.cardNumber,
        });
        const cached = textureCache.get(key);
        if (cached) return cached;

        const pending = pendingTexturePromises.get(key);
        if (pending) return pending;

        const promise = (async () => {
          const htmlImage = await fetchImageElement(deckCard.uris.border_crop);
          const texture = createTextureFromImage(htmlImage);
          textureCache.set(key, texture);
          return texture;
        })().finally(() => {
          pendingTexturePromises.delete(key);
        });
        pendingTexturePromises.set(key, promise);
        return promise;
      },
      getRulings: async (c) => {
        const rulingsUri = c.rulings_uri;
        return getRulings(rulingsUri);
      },
      prefetchSet: async (setCode) => {
        const code = setCode.toLowerCase();
        if (!get().hydratedSets[code]) {
          // Mark hydrated only *after* the fetch lands. Setting it
          // up-front means a single failed call (network blip, 429,
          // Scryfall outage) sticks for the rest of the session and
          // every subsequent caller silently sees an empty set —
          // which propagates to "supplied 0 cards" in WASM.
          const cards = await fetchCardsBySet(code);
          set((state) => {
            state.hydratedSets[code] = true;
          });
          set((state) => {
            for (const card of cards) {
              const uris = chooseImageUrisForCard(card, { frontOnly: true });
              if (!uris) continue;
              const wrapper: ScryfallEntry = {
                card: { info: card, texture: Texture.EMPTY, uris },
              };
              for (const k of mirrorCardKeys(wrapper)) state.cards[k] = wrapper;
            }
          });
        }
        // Warm the browser HTTP cache for every card image — `<img>`
        // tags in the deck-builder will then resolve instantly. We
        // hit `normal` because that's what `CardThumbnail` renders;
        // PIXI textures (`getCardTexture`) are reserved for the game
        // canvas and would over-fetch here.
        if (typeof Image === "undefined") return;
        for (const entry of Object.values(get().cards)) {
          const info = entry.card?.info;
          if (!info || info.set?.toLowerCase() !== code) continue;
          const uris = entry.card?.uris;
          if (!uris?.normal) continue;
          const img = new Image();
          img.src = uris.normal;
        }
      },
      updatePrinting: (print) => {
        const setCnKey = cardKey({
          setCode: print.set,
          collectorNumber: print.collector_number,
        });
        const token = print.layout.includes("token");
        const uris = chooseImageUrisForCard(print, { frontOnly: true });
        if (!uris) {
          throw new Error("Couldnt find uris for printing: " + setCnKey);
        }
        const lowerName = print.name.toLowerCase();
        set((state) => {
          if (!token) {
            // Invalidate every cache entry tied to this card name so
            // stale prints (especially the name-only mirror) don't
            // shadow the new one.
            for (const k of Object.keys(state.cards)) {
              if (state.cards[k].card?.info.name?.toLowerCase() === lowerName) {
                delete state.cards[k];
              }
            }
          }
          const wrapper: ScryfallEntry = {
            card: { info: print, texture: Texture.EMPTY, uris },
          };
          for (const k of mirrorCardKeys(wrapper)) state.cards[k] = wrapper;
        });
        return get().cards[setCnKey].card!;
      },
      invalidateCard: (name) => {
        const lowerName = name.toLowerCase();
        set((state) => {
          for (const k of Object.keys(state.cards)) {
            if (state.cards[k].card?.info.name?.toLowerCase() === lowerName) {
              delete state.cards[k];
            }
          }
        });
      },
      init: async () => {
        const sets = await fetchSets();
        set((state) => {
          state.sets = sets;
        });
      },
    })),
    { name: "scryfall", enabled: import.meta.env.DEV },
  ),
);

export const useCard = (lookup: ScryfallCardLookup | null | undefined) => {
  const getCard = useScryfallStore((s) => s.getCard);
  const name = lookup?.name;
  const id = lookup?.id;
  const setCode = lookup?.setCode;
  const collectorNumber = lookup?.collectorNumber ?? lookup?.cardNumber;
  // Some prompts have no source card (e.g. keyword-driven dice modifiers).
  // Treat that as a no-op rather than throwing inside `cardKey`.
  const hasLookup = Boolean(id) || Boolean(name) || Boolean(setCode && collectorNumber);
  const key = hasLookup ? cardKey({ id, name, setCode, collectorNumber }) : null;
  const cached = useScryfallStore((s) => (key ? (s.cards[key]?.card ?? null) : null));

  useEffect(() => {
    if (!hasLookup || cached) return;
    void getCard({ id, name, setCode, collectorNumber });
  }, [getCard, id, name, setCode, collectorNumber, cached, key, hasLookup]);
  return cached;
};
export const useCardRulings = (card: { rulings_uri?: string }) => {
  const getRulings = useScryfallStore((s) => s.getRulings);
  const [out, setOut] = useState<ScryfallRulingsResponse | null>(null);
  useEffect(() => {
    if (!card.rulings_uri) return;
    getRulings({ rulings_uri: card.rulings_uri }).then(setOut);
  }, [getRulings, card]);
  if (!card.rulings_uri) return EMPTY_RULINGS;
  return out;
};

const EMPTY_RULINGS: ScryfallRulingsResponse = { object: "list", has_more: false, data: [] };

export async function prefetchCards(cards: DeckCard[]): Promise<void> {
  const state = useScryfallStore.getState();
  await Promise.all(
    cards.map((c) =>
      state.getCardTexture(c).catch((err) => {
        console.warn(`[scryfall] prefetch failed for ${c.name}:`, err);
      }),
    ),
  );
}

export function useSetLookup(): Map<string, ScryfallSet> {
  const sets = useScryfallStore((s) => s.sets);
  if (!sets) return new Map();
  return new Map(sets.map((s) => [s.code, s]));
}
