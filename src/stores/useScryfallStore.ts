import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import {
  fetchCardsBySet,
  fetchCardByFuzzyName,
  fetchCardCollection,
  fetchPrintsByOracleIds,
  fetchImageElement,
  fetchSets,
  getCardById,
  getCardByName,
  getCardBySetAndNumber,
  getRulings,
  searchCards,
} from "@/api/scryfall";
import { getPlatformType } from "@/platform";
import { loadScryfallImage, clearScryfallImageCache } from "@/lib/scryfallImageSource";
import type {
  ScryfallCard,
  ScryfallImageUris,
  ScryfallRulingsResponse,
  ScryfallListResponse,
  ScryfallSet,
} from "@/types/scryfall";
import type { DeckCard } from "@/protocol/deck";
import { Texture, ImageSource } from "pixi.js";
import { useEffect, useState } from "react";
import { frontFaceName } from "@/lib/scryfall.utils";
import { cardFaceImageUris } from "@/lib/cardImage";

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
  cardTokenScripts?: Record<string, string[]>;
  tokenScriptPrintIds?: Record<string, string[]>;
  tokens: DeckCard[];
}

interface TokenArchiveIndex {
  tokens: DeckCard[];
  byId: Map<string, DeckCard>;
  byOracleId: Map<string, DeckCard[]>;
  byTokenScript: Map<string, DeckCard[]>;
  tokenScriptsById: Map<string, string[]>;
  byExactSetAndNumber: Map<string, DeckCard>;
  bySetAndNumber: Map<string, DeckCard>;
  byName: Map<string, DeckCard>;
  cardTokenScripts: Record<string, string[]>;
}

export interface ScryfallEntry {
  card?: CardEntry;
  pendingPromise?: Promise<CardEntry>;
}

interface ScryfallState {
  _fetchCardLookup: (lookup: ScryfallCardLookup) => Promise<CardEntry>;
  cards: Record<string, ScryfallEntry>;
  sets: ScryfallSet[];
  hydratedSets: Record<string, true>;
  getCard: (lookup: ScryfallCardLookup) => Promise<CardEntry>;
  getCardTexture: (card: DeckCard, variant?: "full" | "art", faceIndex?: 0 | 1) => Promise<Texture>;
  updatePrinting: (card: ScryfallCard) => CardEntry;
  invalidateCard: (name: string) => void;
  clearImageCaches: () => void;
  getRulings: (card: { rulings_uri: string }) => Promise<ScryfallRulingsResponse>;
  getPrintings: (
    lookups: ScryfallCardLookup[],
    onProgress?: (completed: number, total: number) => void,
    signal?: AbortSignal,
  ) => Promise<Map<string, ScryfallCard[]>>;
  fetchCardCollection: (
    cards: { name: string; setCode?: string; collectorNumber?: string }[],
    signal?: AbortSignal,
  ) => Promise<Map<string, ScryfallCard>>;
  fetchCardByFuzzyName: (name: string) => Promise<ScryfallCard>;
  searchCards: (
    query: string,
    page?: number,
    order?: string,
    dir?: string,
  ) => Promise<ScryfallListResponse>;
  fetchCardsBySet: (setCode: string) => Promise<ScryfallCard[]>;
  fetchSets: () => Promise<ScryfallSet[]>;

  prefetchSet: (setCode: string) => Promise<void>;
}

export function cardKey(lookup: ScryfallCardLookup): string {
  const set = lookup.setCode?.toLowerCase();
  const cn = (lookup.collectorNumber ?? lookup.cardNumber)?.toLowerCase();
  if (set && cn) return `set:${set}::cn:${cn}`;
  if (lookup.name) return `name:${lookup.name.toLowerCase()}`;
  if (lookup.id) return `id:${lookup.id}`;
  throw new Error("cardKey requires setCode+collectorNumber, name, or id");
}

function mirrorCardKeys(entry: ScryfallEntry): string[] {
  const info = entry.card?.info;
  if (!info) return [];
  const keys: string[] = [];
  if (info.set && info.collector_number) {
    keys.push(cardKey({ setCode: info.set, collectorNumber: info.collector_number }));
  }
  const isToken = info.layout?.includes("token");
  if (!isToken && info.name) {
    keys.push(cardKey({ name: info.name }));
    for (const face of info.card_faces ?? []) {
      if (face.name) keys.push(cardKey({ name: face.name }));
    }
  }
  return keys;
}

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
  if (lookup.setCode) {
    try {
      return await getCardByName(lookup.name, lookup.setCode);
    } catch {
      return getCardByName(lookup.name);
    }
  }
  return getCardByName(lookup.name);
}

function normalizeTokenId(id: string): string {
  return id.startsWith("token:") ? id.slice("token:".length) : id;
}

function forgeTokenSetCode(setCode: string): string | null {
  const normalized = setCode.toLowerCase();
  return normalized.startsWith("t") && normalized.length > 1 ? normalized.slice(1) : null;
}

let tokenArchivePromise: Promise<TokenArchiveIndex> | null = null;
let loadedTokenArchive: TokenArchiveIndex | null = null;
const printingsByOracleId = new Map<string, ScryfallCard[]>();

async function loadTokenArchive(): Promise<TokenArchiveIndex> {
  tokenArchivePromise ??= fetch("/token_archive.json")
    .then((response) => {
      if (!response.ok) throw new Error(`Failed to load token archive: ${response.status}`);
      return response.json() as Promise<TokenArchive>;
    })
    .then((archive) => {
      const tokens = archive.tokens.map((t) => ({
        ...t,
        identity: { ...t.identity, name: frontFaceName(t.identity.name) },
      }));
      const byId = new Map<string, DeckCard>();
      const byOracleId = new Map<string, DeckCard[]>();
      const byTokenScript = new Map<string, DeckCard[]>();
      const tokenScriptsById = new Map<string, string[]>();
      const byExactSetAndNumber = new Map<string, DeckCard>();
      const bySetAndNumber = new Map<string, DeckCard>();
      const byName = new Map<string, DeckCard>();
      for (const token of tokens) {
        const { id, oracleId, setCode, cardNumber, name } = token.identity;
        byId.set(id, token);
        byId.set(normalizeTokenId(id), token);
        if (oracleId) {
          const prints = byOracleId.get(oracleId) ?? [];
          prints.push(token);
          byOracleId.set(oracleId, prints);
        }
        const exactKey = cardKey({ setCode, collectorNumber: cardNumber });
        byExactSetAndNumber.set(exactKey, token);
        bySetAndNumber.set(exactKey, token);
        const forgeSetCode = forgeTokenSetCode(setCode);
        if (forgeSetCode) {
          const forgeKey = cardKey({ setCode: forgeSetCode, collectorNumber: cardNumber });
          if (!bySetAndNumber.has(forgeKey)) bySetAndNumber.set(forgeKey, token);
        }
        const lower = name.toLowerCase();
        if (!byName.has(lower)) byName.set(lower, token);
        const withSuffix = `${lower} token`;
        if (!byName.has(withSuffix)) byName.set(withSuffix, token);
      }
      for (const [tokenScript, ids] of Object.entries(archive.tokenScriptPrintIds ?? {})) {
        const prints = ids.flatMap((id) => {
          const token = byId.get(id);
          const scripts = tokenScriptsById.get(id) ?? [];
          scripts.push(tokenScript);
          tokenScriptsById.set(id, scripts);
          tokenScriptsById.set(`token:${id}`, scripts);
          return token ? [{ ...token, identity: { ...token.identity, tokenScript } }] : [];
        });
        if (prints.length > 0) byTokenScript.set(tokenScript, prints);
      }
      const index = {
        tokens,
        byId,
        byOracleId,
        byTokenScript,
        tokenScriptsById,
        byExactSetAndNumber,
        bySetAndNumber,
        byName,
        cardTokenScripts: archive.cardTokenScripts ?? {},
      };
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
    const key = token.identity.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, token);
  }
  return [...byName.values()].sort((a, b) => a.identity.name.localeCompare(b.identity.name));
}

export function peekArchivedToken(
  lookup: {
    id?: string;
    oracleId?: string;
    tokenScript?: string;
    name?: string;
    setCode?: string;
    cardNumber?: string;
  } = {},
): DeckCard | null {
  if (!loadedTokenArchive) return null;
  if (lookup.id) {
    const hit = loadedTokenArchive.byId.get(lookup.id);
    if (hit) return hit;
  }
  if (lookup.oracleId) {
    const hit = loadedTokenArchive.byOracleId.get(lookup.oracleId)?.[0];
    if (hit) return hit;
  }
  if (lookup.tokenScript) {
    const hit = loadedTokenArchive.byTokenScript.get(lookup.tokenScript)?.[0];
    if (hit) return hit;
  }
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

export function tokenIdentityKey(token: DeckCard): string {
  if (token.identity.tokenScript) return `script:${token.identity.tokenScript}`;
  const archived =
    peekArchivedToken({ id: token.identity.id }) ??
    peekArchivedToken({
      setCode: token.identity.setCode,
      cardNumber: token.identity.cardNumber,
    });
  const oracleId = token.identity.oracleId ?? archived?.identity.oracleId;
  const tokenScript = archived
    ? loadedTokenArchive?.tokenScriptsById.get(archived.identity.id)?.[0]
    : undefined;
  if (tokenScript) return `script:${tokenScript}`;
  return oracleId ? `oracle:${oracleId}` : `name:${token.identity.name.toLowerCase()}`;
}

export function getCardTokenScripts(cardName: string): string[] {
  return loadedTokenArchive?.cardTokenScripts[frontFaceName(cardName).toLowerCase()] ?? [];
}

async function lookupArchivedToken(lookup: ScryfallCardLookup): Promise<DeckCard | null> {
  if (lookup.id) {
    const archive = await loadTokenArchive();
    return archive.byId.get(lookup.id) ?? null;
  }
  if (lookup.setCode && lookup.collectorNumber) {
    const archive = await loadTokenArchive();
    return archive.byExactSetAndNumber.get(cardKey(lookup)) ?? null;
  }
  return null;
}

function tokenToScryfallCard(token: DeckCard): ScryfallCard {
  const { id, oracleId, name, setCode, cardNumber } = token.identity;
  const scryfallId = normalizeTokenId(id);
  const typeLine = [...token.supertypes, ...token.types].join(" ");
  const subtypeLine = token.subtypes.length > 0 ? ` — ${token.subtypes.join(" ")}` : "";
  return {
    id: scryfallId,
    oracle_id: oracleId ?? scryfallId,
    name,
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
    set: setCode,
    set_name: setCode.toUpperCase(),
    set_type: "token",
    set_uri: "",
    set_search_uri: "",
    scryfall_set_uri: "",
    rulings_uri: "",
    prints_search_uri: "",
    collector_number: cardNumber,
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

export async function getArchivedTokenPrints(token: DeckCard): Promise<ScryfallCard[]> {
  const archive = await loadTokenArchive();
  if (token.identity.tokenScript) {
    return (archive.byTokenScript.get(token.identity.tokenScript) ?? []).map(tokenToScryfallCard);
  }
  const archived =
    archive.byId.get(token.identity.id) ??
    archive.bySetAndNumber.get(
      cardKey({
        setCode: token.identity.setCode,
        collectorNumber: token.identity.cardNumber,
      }),
    );
  const oracleId = token.identity.oracleId ?? archived?.identity.oracleId;
  if (oracleId) {
    return (archive.byOracleId.get(oracleId) ?? []).map(tokenToScryfallCard);
  }
  const lowerName = token.identity.name.toLowerCase();
  return archive.tokens
    .filter((candidate) => candidate.identity.name.toLowerCase() === lowerName)
    .map(tokenToScryfallCard);
}

export const chooseImageUrisForCard = (
  info: ScryfallCard,
  { frontOnly }: { frontOnly: boolean },
): ScryfallImageUris | null => {
  if (info.image_uris) {
    return info.image_uris;
  }
  if (info.card_faces) {
    for (const f of info.card_faces) {
      if (f.name && f.image_uris && (!frontOnly || f.image_uris.small.includes("/front/"))) {
        return f.image_uris;
      }
    }
  }
  return null;
};

const createTextureFromImage = (img: HTMLImageElement): Texture => {
  const source = new ImageSource({ resource: img });
  const tex = new Texture({ source });
  return tex;
};

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
        try {
          return await pendingPromise;
        } catch (error) {
          set((state) => {
            if (state.cards[key]?.pendingPromise === pendingPromise) delete state.cards[key];
          });
          throw error;
        }
      },
      getCardTexture: async (deckCard, variant = "full", faceIndex = 0) => {
        const pick = (u: ScryfallImageUris | undefined) =>
          variant === "art" ? u?.art_crop : u?.border_crop;
        let url = faceIndex === 0 ? pick(deckCard.uris) : pick(deckCard.backFace?.uris);
        if (!url && faceIndex === 0) {
          const entry = await get().getCard({
            name: deckCard.identity.name,
            setCode: deckCard.identity.setCode || undefined,
            collectorNumber: deckCard.identity.cardNumber || undefined,
          });
          url = pick(cardFaceImageUris(entry.info, entry.uris, faceIndex));
        }
        if (!url) return Texture.EMPTY;

        const cached = textureCache.get(url);
        if (cached) return cached;
        const pending = pendingTexturePromises.get(url);
        if (pending) return pending;

        const resolvedUrl = url;
        const promise = (async () => {
          const htmlImage = await fetchImageElement(resolvedUrl);
          const texture = createTextureFromImage(htmlImage);
          textureCache.set(resolvedUrl, texture);
          return texture;
        })().finally(() => {
          pendingTexturePromises.delete(resolvedUrl);
        });
        pendingTexturePromises.set(resolvedUrl, promise);
        return promise;
      },
      getRulings: async (c) => {
        const rulingsUri = c.rulings_uri;
        return getRulings(rulingsUri);
      },
      getPrintings: async (lookups, onProgress, signal) => {
        const cards = await Promise.all(lookups.map((lookup) => get().getCard(lookup)));
        const oracleIds = [...new Set(cards.map((entry) => entry.info.oracle_id))];
        const missing = oracleIds.filter((id) => !printingsByOracleId.has(id));
        if (missing.length > 0) {
          const fetched = await fetchPrintsByOracleIds(missing, onProgress, signal);
          for (const [oracleId, printings] of fetched) {
            printingsByOracleId.set(oracleId, printings);
          }
        } else {
          onProgress?.(1, 1);
        }
        return new Map(
          cards.map((entry, index) => [
            cardKey(lookups[index]),
            printingsByOracleId.get(entry.info.oracle_id) ?? [],
          ]),
        );
      },
      fetchCardCollection,
      fetchCardByFuzzyName,
      searchCards,
      fetchCardsBySet,
      fetchSets,
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
        if (typeof Image === "undefined") return;
        for (const entry of Object.values(get().cards)) {
          const info = entry.card?.info;
          if (!info || info.set?.toLowerCase() !== code) continue;
          const uris = entry.card?.uris;
          if (!uris?.normal) continue;
          if (getPlatformType() === "tauri") {
            void loadScryfallImage(uris.normal).catch(() => {});
          } else {
            const img = new Image();
            img.src = uris.normal;
          }
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
      clearImageCaches: () => {
        for (const tex of textureCache.values()) tex.destroy(true);
        textureCache.clear();
        pendingTexturePromises.clear();
        clearScryfallImageCache();
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
        console.warn(`[scryfall] prefetch failed for ${c.identity.name}:`, err);
      }),
    ),
  );
}

export function useSetLookup(): Map<string, ScryfallSet> {
  const sets = useScryfallStore((s) => s.sets);
  if (!sets) return new Map();
  return new Map(sets.map((s) => [s.code, s]));
}
