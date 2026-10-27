import { create } from "zustand";
import { persist, devtools, createJSONStorage } from "zustand/middleware";
import { toast } from "sonner";
import type { CardCosmetics, DeckCard, DeckCardIdentity, DeckFormat } from "@/protocol/deck";
import type { PlaymatSettings } from "@/protocol/game";
import type { DeckEditorMetadata, EditorDeck } from "@/types/manabrew";
import type { ScryfallCard } from "@/types/scryfall";
import { STORAGE_KEYS, DEFAULT_DECK_NAME, DEFAULT_IMPORT_NAME } from "@/lib/constants";
import { hasPendingEditorPublication } from "@/lib/authReturn";
import { migrateDeck, completeDeckMigrations } from "@/migrations/deck";
import {
  getFormat,
  canBePartners,
  canBeOathbreaker,
  canBeSignatureSpell,
  formatRequiresCommander,
  canHaveAnyNumberOf,
  copyLimitFromText,
} from "@/lib/formats";
import { resolveTokenCustomizationScript, tokenIdentityKey } from "@/stores/useScryfallStore";
import { collectProducedTokenKeys, deriveTokens } from "@/lib/decks";
import { cardCosmeticsKey, normalizeCardCosmetics, randomCardWearSeed } from "@/lib/cardCosmetics";
import { resolveCardWearAmount } from "@/lib/cardFinish";
import { scryfallToDeckCard } from "@/lib/scryfall.utils";
import { resolveDeckName } from "@/lib/deckName";
import { mergeDeckImportIntoDeck } from "@/lib/deckImport";
/** Migrate legacy "constructed" format id to "standard". */
function migrateFormatId(id: string): DeckFormat {
  if (id === "constructed") return "standard";
  return id as DeckFormat;
}
function getCardUpdateKey(name: string, setCode?: string): string {
  return setCode ? `${name.toLowerCase()}::${setCode.toLowerCase()}` : name.toLowerCase();
}
/** A card patch may carry a partial `identity` (e.g. a reprint changes only
 *  `setCode`/`cardNumber`), deep-merged onto the card's existing identity. */
type CardPatch = Partial<Omit<DeckCard, "identity">> & {
  identity?: Partial<DeckCardIdentity>;
};
function applyPatch(card: DeckCard, patch: CardPatch | undefined): DeckCard {
  if (!patch) return card;
  return { ...card, ...patch, identity: { ...card.identity, ...patch.identity } };
}
function patchCardsByName(cards: DeckCard[], updates: Map<string, CardPatch>): DeckCard[] {
  return cards.map((c) =>
    applyPatch(
      c,
      updates.get(getCardUpdateKey(c.identity.name, c.identity.setCode)) ??
        updates.get(getCardUpdateKey(c.identity.name)),
    ),
  );
}
/** Drop entries from `deck.tokens` whose identity isn't produced by any remaining
 *  card's `allParts`. Called after every card removal so that a customized
 *  token print auto-cleans when its source leaves the deck. */
function pruneOrphanedTokens(deck: EditorDeck): EditorDeck {
  if (!deck.tokens || deck.tokens.length === 0) return deck;
  const produced = collectProducedTokenKeys(deck);
  const tokens = deck.tokens.filter(
    (token) =>
      produced.has(tokenIdentityKey(token)) ||
      produced.has(`name:${token.identity.name.toLowerCase()}`),
  );
  if (tokens.length === deck.tokens.length) return deck;
  return { ...deck, tokens: tokens.length > 0 ? tokens : undefined };
}
function isAttractionCard(card: DeckCard): boolean {
  return card.subtypes?.some((subtype) => subtype.toLowerCase() === "attraction") ?? false;
}
function isContraptionCard(card: DeckCard): boolean {
  return card.subtypes?.some((subtype) => subtype.toLowerCase() === "contraption") ?? false;
}
function isSchemeCard(card: DeckCard): boolean {
  return card.types?.some((type) => type.toLowerCase() === "scheme") ?? false;
}
function isPlaneCard(card: DeckCard): boolean {
  return card.types?.some((type) => type.toLowerCase() === "plane") ?? false;
}
function normalizeCardAppearance(card: DeckCard): DeckCard {
  if (card.identity.cosmetics === undefined) return card;
  const cosmetics = normalizeCardCosmetics(card.identity.cosmetics);
  return { ...card, identity: { ...card.identity, cosmetics } };
}
function createCardOccurrence(card: DeckCard): DeckCard {
  const cosmetics = card.identity.cosmetics;
  return {
    ...card,
    identity: {
      ...card.identity,
      id: crypto.randomUUID(),
      cosmetics:
        resolveCardWearAmount(cosmetics) > 0
          ? { ...cosmetics, wearSeed: randomCardWearSeed() }
          : cosmetics,
    },
  };
}
function canAddToMain(deck: EditorDeck, card: DeckCard): boolean {
  if (canHaveAnyNumberOf(card)) return true;
  const format = getFormat(deck.format ?? "standard");
  if (!format) return true;
  const limit = copyLimitFromText(card.text) ?? format.deckRules.maxCopies;
  return deck.cards.filter((entry) => entry.identity.name === card.identity.name).length < limit;
}
export function normalizeDeck(deck: EditorDeck): EditorDeck {
  const attractions = [...(deck.attractions ?? [])];
  const contraptions = [...(deck.contraptions ?? [])];
  const schemes = [...(deck.schemes ?? [])];
  const planes = [...(deck.planes ?? [])];
  const routeSpecialCards = (cards: DeckCard[]): DeckCard[] =>
    cards.filter((card) => {
      if (isAttractionCard(card)) attractions.push(card);
      else if (isContraptionCard(card)) contraptions.push(card);
      else if (isSchemeCard(card)) schemes.push(card);
      else if (isPlaneCard(card)) planes.push(card);
      else return true;
      return false;
    });
  const main = routeSpecialCards(deck.cards ?? []);
  const sideboard = routeSpecialCards(deck.sideboard ?? []);
  const maybeboard = deck.maybeboard && routeSpecialCards(deck.maybeboard);
  // Migrate legacy single-commander to commanders array
  const commanders = [...(deck.commanders ?? [])];
  const legacy = (
    deck as {
      commander?: DeckCard;
    }
  ).commander;
  if (legacy && !commanders.some((c) => c.identity.name === legacy.identity.name)) {
    commanders.push(legacy);
    const idx = main.findIndex((card) => card.identity.name === legacy.identity.name);
    if (idx !== -1) main.splice(idx, 1);
  }
  const sections = [
    main,
    sideboard,
    maybeboard ?? [],
    attractions,
    contraptions,
    schemes,
    planes,
    commanders,
    deck.companion ? [deck.companion] : [],
  ];
  const reservedIds = new Set<string>();
  for (const cards of sections) {
    for (const card of cards) reservedIds.add(card.identity.id);
  }
  const seenIds = new Set<string>();
  const copyCounts = new Map<string, number>();
  const normalizeOccurrence = (card: DeckCard): DeckCard => {
    const normalized = normalizeCardAppearance(card);
    const id = card.identity.id;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      return normalized;
    }
    let count = copyCounts.get(id) ?? 0;
    let occurrenceId: string;
    do {
      occurrenceId = `${id}:copy:${++count}`;
    } while (reservedIds.has(occurrenceId));
    copyCounts.set(id, count);
    reservedIds.add(occurrenceId);
    return { ...normalized, identity: { ...normalized.identity, id: occurrenceId } };
  };
  const normalized: EditorDeck = {
    ...deck,
    name: resolveDeckName(deck.name, commanders),
    format: migrateFormatId(deck.format ?? (commanders.length > 0 ? "commander" : "standard")),
    cards: main.map(normalizeOccurrence),
    sideboard: sideboard.map(normalizeOccurrence),
    ...(maybeboard && { maybeboard: maybeboard.map(normalizeOccurrence) }),
    attractions: attractions.map(normalizeOccurrence),
    contraptions: contraptions.map(normalizeOccurrence),
    schemes: schemes.map(normalizeOccurrence),
    planes: planes.map(normalizeOccurrence),
    commanders: commanders.length > 0 ? commanders.map(normalizeOccurrence) : undefined,
    companion: deck.companion ? normalizeOccurrence(deck.companion) : undefined,
    tokens: deck.tokens?.map(normalizeCardAppearance),
    editor: normalizeEditorMetadata(deck),
  };
  delete (
    normalized as {
      commander?: DeckCard;
    }
  ).commander;
  return normalized;
}
function normalizeEditorMetadata(deck: EditorDeck): DeckEditorMetadata {
  if (deck.editor?.version === 1) return deck.editor;
  return {
    version: 1,
    tags: (deck.customTags ?? []).map((name) => ({
      id: `legacy:${encodeURIComponent(name.toLowerCase())}`,
      name,
    })),
    layouts: [],
  };
}
function mergeLocalEditorState(deck: EditorDeck, localDeck: EditorDeck | undefined): EditorDeck {
  if (!localDeck) return deck;
  return {
    ...deck,
    customTags: deck.customTags ?? localDeck.customTags,
    cardTags: deck.cardTags ?? localDeck.cardTags,
    editor: deck.editor ?? localDeck.editor,
    playmatUrl: deck.playmatUrl ?? localDeck.playmatUrl,
    playmatAssetId: deck.playmatAssetId ?? localDeck.playmatAssetId,
    playmatSettings: deck.playmatSettings ?? localDeck.playmatSettings,
    stackPositions: deck.stackPositions ?? localDeck.stackPositions,
  };
}
function patchDeckCards(deck: EditorDeck, updates: Map<string, CardPatch>): EditorDeck {
  const normalized = normalizeDeck(deck);
  return {
    ...normalized,
    cards: patchCardsByName(normalized.cards, updates),
    sideboard: patchCardsByName(normalized.sideboard, updates),
    attractions: patchCardsByName(normalized.attractions ?? [], updates),
    contraptions: patchCardsByName(normalized.contraptions ?? [], updates),
    schemes: patchCardsByName(normalized.schemes ?? [], updates),
    planes: patchCardsByName(normalized.planes ?? [], updates),
    commanders: normalized.commanders
      ? patchCardsByName(normalized.commanders, updates)
      : undefined,
    companion: normalized.companion
      ? applyPatch(
          normalized.companion,
          updates.get(
            getCardUpdateKey(
              normalized.companion.identity.name,
              normalized.companion.identity.setCode,
            ),
          ) ?? updates.get(getCardUpdateKey(normalized.companion.identity.name)),
        )
      : undefined,
    maybeboard: normalized.maybeboard
      ? patchCardsByName(normalized.maybeboard, updates)
      : undefined,
    tokens: normalized.tokens,
  };
}
function patchDeckCardById(deck: EditorDeck, cardId: string, patch: CardPatch): EditorDeck {
  const normalized = normalizeDeck(deck);
  const patchCards = (cards: DeckCard[]) =>
    cards.map((card) => (card.identity.id === cardId ? applyPatch(card, patch) : card));
  return {
    ...normalized,
    cards: patchCards(normalized.cards),
    sideboard: patchCards(normalized.sideboard),
    maybeboard: normalized.maybeboard ? patchCards(normalized.maybeboard) : undefined,
    attractions: normalized.attractions ? patchCards(normalized.attractions) : undefined,
    contraptions: normalized.contraptions ? patchCards(normalized.contraptions) : undefined,
    schemes: normalized.schemes ? patchCards(normalized.schemes) : undefined,
    planes: normalized.planes ? patchCards(normalized.planes) : undefined,
    commanders: normalized.commanders ? patchCards(normalized.commanders) : undefined,
    tokens: normalized.tokens ? patchCards(normalized.tokens) : undefined,
    companion:
      normalized.companion?.identity.id === cardId
        ? applyPatch(normalized.companion, patch)
        : normalized.companion,
  };
}
function matchesPrintingVariant(card: DeckCard, printing: DeckCardIdentity): boolean {
  return (
    card.identity.name === printing.name &&
    card.identity.setCode === printing.setCode &&
    card.identity.cardNumber === printing.cardNumber &&
    !!card.identity.foil === !!printing.foil &&
    cardCosmeticsKey(card.identity.cosmetics) === cardCosmeticsKey(printing.cosmetics)
  );
}
export function getCardCustomizationCopy(deck: EditorDeck, cardId: string): DeckCard | undefined {
  const matches = (card: DeckCard) => card.identity.id === cardId;
  return (
    deck.cards.find(matches) ??
    deck.sideboard.find(matches) ??
    deck.maybeboard?.find(matches) ??
    deck.attractions?.find(matches) ??
    deck.contraptions?.find(matches) ??
    deck.schemes?.find(matches) ??
    deck.planes?.find(matches) ??
    deck.commanders?.find(matches) ??
    (deck.companion?.identity.id === cardId ? deck.companion : undefined)
  );
}
function patchDeckPrintingVariant(
  deck: EditorDeck,
  printing: DeckCardIdentity,
  patch: CardPatch,
): EditorDeck {
  const normalized = normalizeDeck(deck);
  const patchCards = (cards: DeckCard[]) =>
    cards.map((card) => (matchesPrintingVariant(card, printing) ? applyPatch(card, patch) : card));
  return {
    ...normalized,
    cards: patchCards(normalized.cards),
    sideboard: patchCards(normalized.sideboard),
    maybeboard: normalized.maybeboard ? patchCards(normalized.maybeboard) : undefined,
    attractions: normalized.attractions ? patchCards(normalized.attractions) : undefined,
    contraptions: normalized.contraptions ? patchCards(normalized.contraptions) : undefined,
    schemes: normalized.schemes ? patchCards(normalized.schemes) : undefined,
    planes: normalized.planes ? patchCards(normalized.planes) : undefined,
    commanders: normalized.commanders ? patchCards(normalized.commanders) : undefined,
    companion:
      normalized.companion && matchesPrintingVariant(normalized.companion, printing)
        ? applyPatch(normalized.companion, patch)
        : normalized.companion,
  };
}
export function availablePrintingFoil(
  printing: DeckCardIdentity,
  scryfallCard: ScryfallCard,
): boolean {
  const finishes = scryfallCard.finishes ?? [];
  if (finishes.length === 0) return !!printing.foil;
  const hasFoil = finishes.some((finish) => finish === "foil" || finish === "etched");
  const hasNonfoil = finishes.includes("nonfoil");
  if (printing.foil && !hasFoil && hasNonfoil) return false;
  if (!printing.foil && !hasNonfoil && hasFoil) return true;
  return !!printing.foil;
}
export function getCardPrintingPatch(printing: ScryfallCard): CardPatch {
  const card = scryfallToDeckCard(printing);
  return {
    identity: {
      setCode: card.identity.setCode,
      cardNumber: card.identity.cardNumber,
      oracleId: card.identity.oracleId,
    },
    uris: card.uris,
    imageLanguage: card.imageLanguage,
    layout: card.layout,
    isDoubleFaced: card.isDoubleFaced,
    backFace: card.backFace,
  };
}
export interface SavedDeck {
  id: string;
  deck: EditorDeck;
  savedAt: number;
  accountDeckId?: string;
  accountVersionNo?: number;
}
// Playmats used to be an inline `data:` blob under `playmat`. That field is gone,
// but a spread would still carry a stored blob back onto the wire, so persisted
// decks are stripped of it on the way in — which is also what reclaims the
// localStorage the blobs were occupying.
function dropInlinePlaymat<T extends object>(deck: T): T {
  const { playmat: _playmat, ...rest } = deck as T & {
    playmat?: string;
  };
  return rest as T;
}
// False until hydration succeeds, so a failed migration can't persist over the
// stored decks — writes are dropped and the on-disk data survives untouched.
let deckPersistReady = false;
const deckStorage = createJSONStorage(() => ({
  getItem: (name) => localStorage.getItem(name),
  setItem: (name, value) => {
    if (!deckPersistReady) return;
    try {
      localStorage.setItem(name, value);
    } catch {
      toast.error(
        `Seems like you reached the limit of your browser storage \u2014 contact us on Discord for more info.`,
        { id: "deck-storage-full" },
      );
    }
  },
  removeItem: (name) => localStorage.removeItem(name),
}));
interface DeckState {
  currentDeck: EditorDeck;
  currentDeckId: string | null;
  editorSessionId: string;
  isReadOnly: boolean;
  readOnlySource: "preset" | "hub" | null;
  savedDecks: SavedDeck[];
  migrationError: boolean;
  addToMain: (card: DeckCard) => void;
  addToSide: (card: DeckCard) => void;
  addToMaybe: (card: DeckCard) => void;
  moveCards: (cardIds: Iterable<string>, destination: "main" | "side" | "maybe") => number;
  removeFromMaybe: (cardId: string) => void;
  removeFromMain: (cardId: string) => void;
  removeFromSide: (cardId: string) => void;
  setDeckName: (name: string) => void;
  setDeckFormat: (format: DeckFormat) => void;
  clearDeck: () => void;
  loadDeck: (deck: EditorDeck) => void;
  loadPresetDeck: (deck: EditorDeck) => void;
  loadHubDeck: (deck: EditorDeck) => void;
  importReadOnlyDeck: () => string | null;
  addSavedDeck: (deck: EditorDeck) => string;
  mergeIntoCurrentDeck: (sections: {
    cards: DeckCard[];
    sideboard: DeckCard[];
    maybeboard: DeckCard[];
    commanders: DeckCard[];
  }) => void;
  saveCurrentDeck: () => void;
  saveDraft: () => void;
  loadSavedDeck: (id: string) => void;
  loadAccountDeck: (accountDeckId: string, versionNo: number, deck: EditorDeck) => string;
  linkSavedDeckToAccount: (
    localDeckId: string | null,
    accountDeckId: string,
    versionNo: number,
    deck: EditorDeck,
  ) => void;
  updateAccountDeckVersion: (accountDeckId: string, versionNo: number, deck: EditorDeck) => void;
  deleteSavedDeck: (id: string) => void;
  setCommander: (card: DeckCard) => void;
  removeCommander: (card?: DeckCard) => void;
  updatePrint: (cardName: string, scryfallCard: ScryfallCard) => void;
  updateCardPrint: (cardId: string, scryfallCard: ScryfallCard, foil?: boolean) => void;
  updatePrintingVariant: (printing: DeckCardIdentity, scryfallCard: ScryfallCard) => void;
  setCardFoil: (cardId: string, foil: boolean) => void;
  setCardCosmetics: (
    changes: readonly {
      cardId: string;
      cosmetics: CardCosmetics | undefined;
      foil: boolean;
      printing?: ScryfallCard;
    }[],
  ) => void;
  setTokenCosmetics: (
    card: DeckCard,
    cosmetics: CardCosmetics | undefined,
    foil: boolean,
    printing?: ScryfallCard,
  ) => void;
  updateTokenPrint: (token: DeckCard, scryfallCard: ScryfallCard) => void;
  resetTokenPrint: (token: DeckCard) => void;
  enrichDeckCards: (updates: Map<string, CardPatch>) => void;
  addCardToSavedDeck: (id: string, card: DeckCard) => void;
  enrichSavedDeck: (id: string, updates: Map<string, CardPatch>) => void;
  addCustomTag: (tag: string) => void;
  removeCustomTag: (tag: string) => void;
  renameCustomTag: (tag: string, name: string) => void;
  reorderCustomTag: (tag: string, direction: -1 | 1) => void;
  tagCard: (cardName: string, tag: string) => void;
  untagCard: (cardName: string, tag: string) => void;
  addDeckLabel: (label: string, color?: string) => void;
  removeDeckLabel: (label: string) => void;
  updateDeckLabelColor: (label: string, color?: string) => void;
  setCoverCard: (name: string | undefined, face?: 0 | 1) => void;
  setPlaymat: (url: string | undefined, assetId: string | undefined) => void;
  replacePlaymatAsset: (
    previousAssetId: string,
    next:
      | {
          assetId: string;
          url: string;
        }
      | undefined,
  ) => void;
  setPlaymatSettings: (settings: PlaymatSettings | undefined) => void;
  setStackPositions: (
    positions: Record<
      string,
      {
        x: number;
        y: number;
      }
    >,
  ) => void;
  setEditorMetadata: (metadata: DeckEditorMetadata) => void;
}
const initialDeck: EditorDeck = {
  name: DEFAULT_DECK_NAME,
  format: "standard",
  cards: [],
  sideboard: [],
  attractions: [],
  contraptions: [],
  schemes: [],
  planes: [],
};
export const useDeckStore = create<DeckState>()(
  devtools(
    persist(
      (set, get) => ({
        currentDeck: initialDeck,
        currentDeckId: null,
        editorSessionId: crypto.randomUUID(),
        isReadOnly: false,
        readOnlySource: null,
        savedDecks: [],
        migrationError: false,
        addToMain: (card) =>
          set((state) => {
            if (!canAddToMain(state.currentDeck, card)) return state;
            return {
              currentDeck: normalizeDeck({
                ...state.currentDeck,
                cards: [...state.currentDeck.cards, createCardOccurrence(card)],
              }),
            };
          }),
        addToSide: (card) =>
          set((state) => ({
            currentDeck: normalizeDeck({
              ...state.currentDeck,
              sideboard: [...state.currentDeck.sideboard, createCardOccurrence(card)],
            }),
          })),
        addToMaybe: (card) =>
          set((state) => ({
            currentDeck: normalizeDeck({
              ...state.currentDeck,
              maybeboard: [...(state.currentDeck.maybeboard ?? []), createCardOccurrence(card)],
            }),
          })),
        moveCards: (cardIds, destination) => {
          const ids = new Set(cardIds);
          let moved = 0;
          set((state) => {
            const deck = {
              ...state.currentDeck,
              cards: [...state.currentDeck.cards],
              sideboard: [...state.currentDeck.sideboard],
              maybeboard: [...(state.currentDeck.maybeboard ?? [])],
            };
            const target =
              destination === "main"
                ? "cards"
                : destination === "side"
                  ? "sideboard"
                  : "maybeboard";
            for (const source of ["cards", "sideboard", "maybeboard"] as const) {
              if (source === target) continue;
              deck[source] = deck[source].filter((card) => {
                if (!ids.has(card.identity.id)) return true;
                if (target === "cards" && !canAddToMain(deck, card)) return true;
                deck[target].push(card);
                moved += 1;
                return false;
              });
            }
            return moved > 0 ? { currentDeck: normalizeDeck(deck) } : state;
          });
          return moved;
        },
        removeFromMaybe: (cardId) =>
          set((state) => {
            const idx = (state.currentDeck.maybeboard ?? []).findIndex(
              (c) => c.identity.id === cardId,
            );
            if (idx === -1) return state;
            const maybeboard = [...(state.currentDeck.maybeboard ?? [])];
            maybeboard.splice(idx, 1);
            return { currentDeck: pruneOrphanedTokens({ ...state.currentDeck, maybeboard }) };
          }),
        removeFromMain: (cardId) =>
          set((state) => {
            const index = state.currentDeck.cards.findIndex((c) => c.identity.id === cardId);
            if (index === -1) return state;
            const newCards = [...state.currentDeck.cards];
            newCards.splice(index, 1);
            return {
              currentDeck: pruneOrphanedTokens({ ...state.currentDeck, cards: newCards }),
            };
          }),
        removeFromSide: (cardId) =>
          set((state) => {
            const deck = normalizeDeck(state.currentDeck);
            const sideIndex = deck.sideboard.findIndex((c) => c.identity.id === cardId);
            if (sideIndex !== -1) {
              const sideboard = [...deck.sideboard];
              sideboard.splice(sideIndex, 1);
              return { currentDeck: pruneOrphanedTokens({ ...deck, sideboard }) };
            }
            const attractionIndex = (deck.attractions ?? []).findIndex(
              (c) => c.identity.id === cardId,
            );
            if (attractionIndex !== -1) {
              const attractions = [...(deck.attractions ?? [])];
              attractions.splice(attractionIndex, 1);
              return { currentDeck: pruneOrphanedTokens({ ...deck, attractions }) };
            }
            const contraptionIndex = (deck.contraptions ?? []).findIndex(
              (c) => c.identity.id === cardId,
            );
            if (contraptionIndex !== -1) {
              const contraptions = [...(deck.contraptions ?? [])];
              contraptions.splice(contraptionIndex, 1);
              return { currentDeck: pruneOrphanedTokens({ ...deck, contraptions }) };
            }
            const schemeIndex = (deck.schemes ?? []).findIndex((c) => c.identity.id === cardId);
            if (schemeIndex !== -1) {
              const schemes = [...(deck.schemes ?? [])];
              schemes.splice(schemeIndex, 1);
              return { currentDeck: pruneOrphanedTokens({ ...deck, schemes }) };
            }
            const planeIndex = (deck.planes ?? []).findIndex((c) => c.identity.id === cardId);
            if (planeIndex !== -1) {
              const planes = [...(deck.planes ?? [])];
              planes.splice(planeIndex, 1);
              return { currentDeck: pruneOrphanedTokens({ ...deck, planes }) };
            }
            return state;
          }),
        setDeckName: (name) =>
          set((state) => ({
            currentDeck: { ...state.currentDeck, name },
          })),
        setDeckFormat: (format) =>
          set((state) => {
            const deck = normalizeDeck(state.currentDeck);
            if (
              !getFormat(format)?.deckRules.requiresCommander &&
              (deck.commanders?.length ?? 0) > 0
            ) {
              return {
                currentDeck: {
                  ...deck,
                  format,
                  cards: [...deck.cards, ...(deck.commanders ?? [])],
                  commanders: undefined,
                },
              };
            }
            return {
              currentDeck: {
                ...deck,
                format,
              },
            };
          }),
        clearDeck: () =>
          set({
            currentDeck: { ...initialDeck },
            currentDeckId: null,
            editorSessionId: crypto.randomUUID(),
            isReadOnly: false,
            readOnlySource: null,
          }),
        loadDeck: (deck) =>
          set({
            currentDeck: normalizeDeck(migrateDeck(deck)),
            editorSessionId: crypto.randomUUID(),
            isReadOnly: false,
            readOnlySource: null,
          }),
        loadPresetDeck: (deck) =>
          set({
            currentDeck: normalizeDeck(deck),
            currentDeckId: null,
            editorSessionId: crypto.randomUUID(),
            isReadOnly: true,
            readOnlySource: "preset",
          }),
        loadHubDeck: (deck) =>
          set({
            currentDeck: normalizeDeck(deck),
            currentDeckId: null,
            editorSessionId: crypto.randomUUID(),
            isReadOnly: true,
            readOnlySource: "hub",
          }),
        importReadOnlyDeck: () => {
          const state = get();
          const id = crypto.randomUUID();
          const baseName = state.currentDeck.name || DEFAULT_DECK_NAME;
          const importedName = baseName.endsWith(" (Copy)") ? baseName : `${baseName} (Copy)`;
          const imported: EditorDeck = {
            ...normalizeDeck(state.currentDeck),
            name: importedName,
            id: undefined,
          };
          const savedDeck: SavedDeck = { id, deck: imported, savedAt: Date.now() };
          set((s) => ({
            currentDeck: imported,
            currentDeckId: id,
            editorSessionId: crypto.randomUUID(),
            isReadOnly: false,
            readOnlySource: null,
            savedDecks: [...s.savedDecks, savedDeck],
          }));
          return id;
        },
        addSavedDeck: (deck) => {
          const id = crypto.randomUUID();
          set((s) => ({
            savedDecks: [...s.savedDecks, { id, deck: normalizeDeck(deck), savedAt: Date.now() }],
          }));
          return id;
        },
        mergeIntoCurrentDeck: (sections) =>
          set((state) => {
            const deck = normalizeDeck(state.currentDeck);
            return {
              currentDeck: normalizeDeck(mergeDeckImportIntoDeck(deck, sections)),
            };
          }),
        setCommander: (card) =>
          set((state) => {
            const deck = normalizeDeck(state.currentDeck);
            if (deck.commanders?.some((entry) => entry.identity.id === card.identity.id)) {
              return state;
            }
            const nextMain = [...deck.cards];
            const nextSide = [...deck.sideboard];
            const nextMaybe = [...(deck.maybeboard ?? [])];
            let selectedCard: DeckCard | undefined;
            for (const cards of [nextMain, nextSide, nextMaybe]) {
              const index = cards.findIndex((entry) => entry.identity.id === card.identity.id);
              if (index === -1) continue;
              selectedCard = cards.splice(index, 1)[0];
              break;
            }
            selectedCard ??= createCardOccurrence(card);
            let commanders = [...(deck.commanders ?? [])];
            const returnToMain = (c: DeckCard) => nextMain.push(c);
            if (deck.format === "oathbreaker") {
              const oathbreakers = commanders.filter((c) => canBeOathbreaker(c));
              const spells = commanders.filter((c) => canBeSignatureSpell(c));
              if (canBeSignatureSpell(selectedCard)) {
                while (spells.length >= Math.max(1, oathbreakers.length)) {
                  returnToMain(spells.shift()!);
                }
                spells.push(selectedCard);
              } else if (
                oathbreakers.length === 1 &&
                canBePartners(oathbreakers[0], selectedCard)
              ) {
                oathbreakers.push(selectedCard);
              } else {
                while (oathbreakers.length) returnToMain(oathbreakers.shift()!);
                oathbreakers.push(selectedCard);
                while (spells.length > 1) returnToMain(spells.shift()!);
              }
              commanders = oathbreakers.flatMap((o, i) => (spells[i] ? [o, spells[i]] : [o]));
              commanders.push(...spells.slice(oathbreakers.length));
            } else {
              if (commanders.length >= 1) {
                if (!canBePartners(commanders[0], selectedCard)) {
                  for (const c of commanders.splice(0)) returnToMain(c);
                } else if (commanders.length >= 2) {
                  returnToMain(commanders.pop()!);
                }
              }
              commanders.push(selectedCard);
            }
            const autoRename = deck.name === DEFAULT_IMPORT_NAME || deck.name === DEFAULT_DECK_NAME;
            return {
              currentDeck: {
                ...deck,
                name: autoRename ? commanders.map((c) => c.identity.name).join(" / ") : deck.name,
                format: formatRequiresCommander(deck.format) ? deck.format : "commander",
                cards: nextMain,
                sideboard: nextSide,
                maybeboard: nextMaybe,
                commanders,
              },
            };
          }),
        removeCommander: (card?: DeckCard) =>
          set((state) => {
            const deck = normalizeDeck(state.currentDeck);
            const commanders = deck.commanders ?? [];
            if (commanders.length === 0) return state;
            const toRemove = card
              ? commanders.find((c) => c.identity.id === card.identity.id)
              : commanders[commanders.length - 1];
            if (!toRemove) return state;
            return {
              currentDeck: {
                ...deck,
                cards: [...deck.cards, toRemove],
                commanders: commanders.filter((c) => c.identity.id !== toRemove.identity.id),
              },
            };
          }),
        resetTokenPrint: (token) =>
          set((state) => {
            const key = tokenIdentityKey(token);
            const tokens = (state.currentDeck.tokens ?? []).filter(
              (candidate) => tokenIdentityKey(candidate) !== key,
            );
            const cosmetics = normalizeCardCosmetics(token.identity.cosmetics);
            const defaultToken = cosmetics
              ? deriveTokens(state.currentDeck).find(
                  (candidate) => tokenIdentityKey(candidate) === key,
                )
              : undefined;
            if (defaultToken) {
              tokens.push({
                ...defaultToken,
                identity: {
                  ...defaultToken.identity,
                  tokenScript: resolveTokenCustomizationScript(token),
                  cosmetics,
                },
              });
            }
            return {
              currentDeck: {
                ...state.currentDeck,
                tokens: tokens.length > 0 ? tokens : undefined,
              },
            };
          }),
        updatePrint: (cardName, scryfallCard) =>
          set((state) => {
            const updates = new Map<string, CardPatch>();
            updates.set(cardName.toLowerCase(), getCardPrintingPatch(scryfallCard));
            return {
              currentDeck: patchDeckCards(state.currentDeck, updates),
            };
          }),
        updateCardPrint: (cardId, scryfallCard, foil) =>
          set((state) => {
            const patch = getCardPrintingPatch(scryfallCard);
            return {
              currentDeck: patchDeckCardById(state.currentDeck, cardId, {
                ...patch,
                identity: {
                  ...patch.identity,
                  ...(foil === undefined ? {} : { foil }),
                },
              }),
            };
          }),
        updatePrintingVariant: (printing, scryfallCard) =>
          set((state) => {
            const patch = getCardPrintingPatch(scryfallCard);
            return {
              currentDeck: patchDeckPrintingVariant(state.currentDeck, printing, {
                ...patch,
                identity: {
                  ...patch.identity,
                  foil: availablePrintingFoil(printing, scryfallCard),
                },
              }),
            };
          }),
        setCardFoil: (cardId, foil) =>
          set((state) => ({
            currentDeck: patchDeckCardById(state.currentDeck, cardId, { identity: { foil } }),
          })),
        setCardCosmetics: (changes) =>
          set((state) => {
            if (state.isReadOnly || changes.length === 0) return state;
            const updates = new Map<string, CardPatch>();
            for (const { cardId, cosmetics, foil, printing } of changes) {
              const patch = printing ? getCardPrintingPatch(printing) : undefined;
              updates.set(cardId, {
                ...patch,
                identity: {
                  ...patch?.identity,
                  cosmetics: normalizeCardCosmetics(cosmetics),
                  foil,
                },
              });
            }
            let changed = false;
            const customize = (card: DeckCard) => {
              const patch = updates.get(card.identity.id);
              if (!patch) return card;
              changed = true;
              return applyPatch(card, patch);
            };
            const deck = state.currentDeck;
            const currentDeck = {
              ...deck,
              cards: deck.cards.map(customize),
              sideboard: deck.sideboard.map(customize),
              maybeboard: deck.maybeboard?.map(customize),
              attractions: deck.attractions?.map(customize),
              contraptions: deck.contraptions?.map(customize),
              schemes: deck.schemes?.map(customize),
              planes: deck.planes?.map(customize),
              commanders: deck.commanders?.map(customize),
              companion: deck.companion ? customize(deck.companion) : undefined,
            };
            return changed ? { currentDeck } : state;
          }),
        setTokenCosmetics: (card, value, foil, printing) =>
          set((state) => {
            if (state.isReadOnly) return state;
            const cosmetics = normalizeCardCosmetics(value);
            const tokens = state.currentDeck.tokens ?? [];
            const key = tokenIdentityKey(card);
            const tokenScript = resolveTokenCustomizationScript(card);
            if (cosmetics && !tokenScript) return state;
            const existing = tokens.find((candidate) => tokenIdentityKey(candidate) === key);
            const source = existing ?? card;
            const patch = printing ? getCardPrintingPatch(printing) : undefined;
            const customized = applyPatch(source, {
              ...patch,
              identity: {
                ...patch?.identity,
                tokenScript,
                cosmetics,
                foil,
              },
            });
            return {
              currentDeck: {
                ...state.currentDeck,
                tokens: existing
                  ? tokens.map((candidate) => (candidate === existing ? customized : candidate))
                  : [...tokens, customized],
              },
            };
          }),
        updateTokenPrint: (token, scryfallCard) =>
          set((state) => {
            const patch = getCardPrintingPatch(scryfallCard);
            const key = tokenIdentityKey(token);
            const existing = state.currentDeck.tokens ?? [];
            const source =
              existing.find((candidate) => tokenIdentityKey(candidate) === key) ?? token;
            const customized = applyPatch(source, {
              ...patch,
              identity: {
                ...patch.identity,
                tokenScript: resolveTokenCustomizationScript(token),
                id: `token:${scryfallCard.id}`,
              },
            });
            const replaced = existing.some((candidate) => tokenIdentityKey(candidate) === key);
            return {
              currentDeck: {
                ...state.currentDeck,
                tokens: replaced
                  ? existing.map((candidate) =>
                      tokenIdentityKey(candidate) === key ? customized : candidate,
                    )
                  : [...existing, customized],
              },
            };
          }),
        saveCurrentDeck: () =>
          set((state) => {
            const deckToSave = { ...state.currentDeck, draft: undefined };
            // Match by tracked ID first, then fall back to name match
            const existing = state.currentDeckId
              ? state.savedDecks.find((s) => s.id === state.currentDeckId)
              : state.savedDecks.find((s) => s.deck.name === state.currentDeck.name);
            if (existing) {
              return {
                currentDeckId: existing.id,
                currentDeck: deckToSave,
                savedDecks: state.savedDecks.map((s) =>
                  s.id === existing.id ? { ...s, deck: deckToSave, savedAt: Date.now() } : s,
                ),
              };
            }
            const newId = crypto.randomUUID();
            const newSaved: SavedDeck = {
              id: newId,
              deck: normalizeDeck(deckToSave),
              savedAt: Date.now(),
            };
            return { currentDeckId: newId, savedDecks: [...state.savedDecks, newSaved] };
          }),
        saveDraft: () =>
          set((state) => {
            const draftDeck = { ...state.currentDeck, draft: true };
            const existing = state.currentDeckId
              ? state.savedDecks.find((s) => s.id === state.currentDeckId)
              : state.savedDecks.find((s) => s.deck.name === state.currentDeck.name);
            if (existing) {
              return {
                currentDeckId: existing.id,
                currentDeck: draftDeck,
                savedDecks: state.savedDecks.map((s) =>
                  s.id === existing.id ? { ...s, deck: draftDeck, savedAt: Date.now() } : s,
                ),
              };
            }
            const newId = crypto.randomUUID();
            return {
              currentDeckId: newId,
              currentDeck: draftDeck,
              savedDecks: [
                ...state.savedDecks,
                { id: newId, deck: normalizeDeck(draftDeck), savedAt: Date.now() },
              ],
            };
          }),
        loadSavedDeck: (id) =>
          set((state) => {
            const found = state.savedDecks.find((s) => s.id === id);
            if (!found) return state;
            return {
              currentDeck: normalizeDeck(migrateDeck(found.deck)),
              currentDeckId: id,
              editorSessionId: crypto.randomUUID(),
              isReadOnly: false,
              readOnlySource: null,
            };
          }),
        loadAccountDeck: (accountDeckId, versionNo, deck) => {
          const id = `account:${accountDeckId}`;
          const existing = get().savedDecks.find(
            (saved) => saved.id === id || saved.accountDeckId === accountDeckId,
          );
          const normalized = mergeLocalEditorState(
            normalizeDeck(migrateDeck(deck)),
            existing?.deck,
          );
          set((state) => ({
            currentDeck: normalized,
            currentDeckId: id,
            editorSessionId: crypto.randomUUID(),
            isReadOnly: false,
            readOnlySource: null,
            savedDecks: [
              ...state.savedDecks.filter(
                (saved) => saved.id !== id && saved.accountDeckId !== accountDeckId,
              ),
              {
                id,
                deck: normalized,
                savedAt: Date.now(),
                accountDeckId,
                accountVersionNo: versionNo,
              },
            ],
          }));
          return id;
        },
        linkSavedDeckToAccount: (localDeckId, accountDeckId, versionNo, deck) =>
          set((state) => {
            const id = `account:${accountDeckId}`;
            const editingLinkedDeck = localDeckId !== null && state.currentDeckId === localDeckId;
            const localDeck =
              state.savedDecks.find((saved) => saved.id === localDeckId)?.deck ??
              (editingLinkedDeck ? state.currentDeck : undefined);
            const normalized = mergeLocalEditorState(normalizeDeck(migrateDeck(deck)), localDeck);
            return {
              currentDeck: editingLinkedDeck ? normalized : state.currentDeck,
              currentDeckId: editingLinkedDeck ? id : state.currentDeckId,
              savedDecks: [
                ...state.savedDecks.filter(
                  (saved) =>
                    saved.id !== localDeckId &&
                    saved.id !== id &&
                    saved.accountDeckId !== accountDeckId,
                ),
                {
                  id,
                  deck: normalized,
                  savedAt: Date.now(),
                  accountDeckId,
                  accountVersionNo: versionNo,
                },
              ],
            };
          }),
        updateAccountDeckVersion: (accountDeckId, versionNo, deck) =>
          set((state) => {
            const id = `account:${accountDeckId}`;
            const existing = state.savedDecks.find(
              (saved) => saved.id === id || saved.accountDeckId === accountDeckId,
            );
            const normalized = mergeLocalEditorState(
              normalizeDeck(migrateDeck(deck)),
              existing?.deck ?? (state.currentDeckId === id ? state.currentDeck : undefined),
            );
            return {
              currentDeck: state.currentDeckId === id ? normalized : state.currentDeck,
              savedDecks: state.savedDecks.map((saved) =>
                saved.id === id
                  ? {
                      ...saved,
                      deck: normalized,
                      savedAt: Date.now(),
                      accountVersionNo: versionNo,
                    }
                  : saved,
              ),
            };
          }),
        deleteSavedDeck: (id) =>
          set((state) => ({
            savedDecks: state.savedDecks.filter((s) => s.id !== id),
          })),
        enrichDeckCards: (updates) =>
          set((state) => {
            return {
              currentDeck: patchDeckCards(state.currentDeck, updates),
            };
          }),
        addCardToSavedDeck: (id, card) =>
          set((state) => ({
            savedDecks: state.savedDecks.map((s) =>
              s.id !== id
                ? s
                : {
                    ...s,
                    deck: normalizeDeck({
                      ...s.deck,
                      cards: [...s.deck.cards, createCardOccurrence(card)],
                    }),
                    savedAt: Date.now(),
                  },
            ),
          })),
        enrichSavedDeck: (id, updates) =>
          set((state) => ({
            savedDecks: state.savedDecks.map((s) =>
              s.id !== id
                ? s
                : {
                    ...s,
                    deck: patchDeckCards(s.deck, updates),
                  },
            ),
          })),
        addCustomTag: (tag) =>
          set((state) => {
            const nextTag = tag.trim();
            const existing = state.currentDeck.customTags ?? [];
            if (
              !nextTag ||
              existing.some((candidate) => candidate.toLowerCase() === nextTag.toLowerCase())
            ) {
              return state;
            }
            const editor = normalizeEditorMetadata(state.currentDeck);
            return {
              currentDeck: {
                ...state.currentDeck,
                customTags: [...existing, nextTag],
                editor: {
                  ...editor,
                  tags: [...editor.tags, { id: crypto.randomUUID(), name: nextTag }],
                },
              },
            };
          }),
        removeCustomTag: (tag) =>
          set((state) => {
            const customTags = (state.currentDeck.customTags ?? []).filter((t) => t !== tag);
            const cardTags = { ...state.currentDeck.cardTags };
            const editor = normalizeEditorMetadata(state.currentDeck);
            for (const key of Object.keys(cardTags)) {
              cardTags[key] = cardTags[key].filter((t) => t !== tag);
              if (cardTags[key].length === 0) delete cardTags[key];
            }
            return {
              currentDeck: {
                ...state.currentDeck,
                customTags,
                cardTags,
                editor: {
                  ...editor,
                  tags: editor.tags.filter((candidate) => candidate.name !== tag),
                },
              },
            };
          }),
        renameCustomTag: (tag, name) =>
          set((state) => {
            const nextName = name.trim();
            if (!nextName || tag === nextName) return state;
            if (
              (state.currentDeck.customTags ?? []).some(
                (candidate) =>
                  candidate !== tag && candidate.toLowerCase() === nextName.toLowerCase(),
              )
            ) {
              return state;
            }
            const customTags = (state.currentDeck.customTags ?? []).map((candidate) =>
              candidate === tag ? nextName : candidate,
            );
            const cardTags = Object.fromEntries(
              Object.entries(state.currentDeck.cardTags ?? {}).map(([cardName, tags]) => [
                cardName,
                tags.map((candidate) => (candidate === tag ? nextName : candidate)),
              ]),
            );
            const editor = normalizeEditorMetadata(state.currentDeck);
            return {
              currentDeck: {
                ...state.currentDeck,
                customTags,
                cardTags,
                editor: {
                  ...editor,
                  tags: editor.tags.map((candidate) =>
                    candidate.name === tag ? { ...candidate, name: nextName } : candidate,
                  ),
                },
              },
            };
          }),
        reorderCustomTag: (tag, direction) =>
          set((state) => {
            const customTags = [...(state.currentDeck.customTags ?? [])];
            const index = customTags.indexOf(tag);
            const target = index + direction;
            if (index === -1 || target < 0 || target >= customTags.length) return state;
            [customTags[index], customTags[target]] = [customTags[target], customTags[index]];
            const editor = normalizeEditorMetadata(state.currentDeck);
            const order = new Map(customTags.map((name, position) => [name, position]));
            return {
              currentDeck: {
                ...state.currentDeck,
                customTags,
                editor: {
                  ...editor,
                  tags: [...editor.tags].sort(
                    (a, b) => (order.get(a.name) ?? 0) - (order.get(b.name) ?? 0),
                  ),
                },
              },
            };
          }),
        tagCard: (cardName, tag) =>
          set((state) => {
            const key = cardName.toLowerCase();
            const normalizedTag =
              (state.currentDeck.customTags ?? []).find(
                (candidate) => candidate.toLowerCase() === tag.trim().toLowerCase(),
              ) ?? tag.trim();
            if (!normalizedTag) return state;
            const cardTags = { ...state.currentDeck.cardTags };
            const tags = cardTags[key] ?? [];
            if (tags.includes(normalizedTag)) return state;
            cardTags[key] = [...tags, normalizedTag];
            return {
              currentDeck: { ...state.currentDeck, cardTags },
            };
          }),
        untagCard: (cardName, tag) =>
          set((state) => {
            const key = cardName.toLowerCase();
            const cardTags = { ...state.currentDeck.cardTags };
            const tags = cardTags[key] ?? [];
            cardTags[key] = tags.filter((t) => t !== tag);
            if (cardTags[key].length === 0) delete cardTags[key];
            return {
              currentDeck: { ...state.currentDeck, cardTags },
            };
          }),
        addDeckLabel: (label, color) =>
          set((state) => {
            const existing = state.currentDeck.labels ?? [];
            if (existing.some((l) => l.name.toLowerCase() === label.toLowerCase())) return state;
            return {
              currentDeck: { ...state.currentDeck, labels: [...existing, { name: label, color }] },
            };
          }),
        removeDeckLabel: (label) =>
          set((state) => ({
            currentDeck: {
              ...state.currentDeck,
              labels: (state.currentDeck.labels ?? []).filter((l) => l.name !== label),
            },
          })),
        updateDeckLabelColor: (label, color) =>
          set((state) => ({
            currentDeck: {
              ...state.currentDeck,
              labels: (state.currentDeck.labels ?? []).map((l) =>
                l.name === label ? { ...l, color } : l,
              ),
            },
          })),
        setCoverCard: (name, face) =>
          set((state) => ({
            currentDeck: {
              ...state.currentDeck,
              coverCardName: name,
              coverCardFace: name !== undefined ? (face ?? 0) : undefined,
            },
          })),
        setPlaymat: (url, assetId) =>
          set((state) => ({
            currentDeck: { ...state.currentDeck, playmatUrl: url, playmatAssetId: assetId },
          })),
        replacePlaymatAsset: (previousAssetId, next) =>
          set((state) => ({
            savedDecks: state.savedDecks.map((saved) =>
              saved.deck.playmatAssetId === previousAssetId
                ? {
                    ...saved,
                    deck: { ...saved.deck, playmatUrl: next?.url, playmatAssetId: next?.assetId },
                  }
                : saved,
            ),
            currentDeck:
              state.currentDeck.playmatAssetId === previousAssetId
                ? { ...state.currentDeck, playmatUrl: next?.url, playmatAssetId: next?.assetId }
                : state.currentDeck,
          })),
        setPlaymatSettings: (settings) =>
          set((state) => ({
            currentDeck: { ...state.currentDeck, playmatSettings: settings },
          })),
        setStackPositions: (positions) =>
          set((state) => ({
            currentDeck: { ...state.currentDeck, stackPositions: positions },
          })),
        setEditorMetadata: (metadata) =>
          set((state) => ({
            currentDeck: { ...state.currentDeck, editor: metadata },
          })),
      }),
      {
        name: STORAGE_KEYS.DECK,
        storage: deckStorage,
        partialize: ({ editorSessionId: _editorSessionId, ...state }) => ({
          ...state,
          savedDecks: state.savedDecks.filter((saved) => !saved.accountDeckId),
        }),
        // Bump on any persisted-deck shape change so `migrate` runs over existing
        // users' decks — a shape change without a bump never migrates.
        version: 8,
        migrate: (persistedState: unknown) => {
          if (!persistedState || typeof persistedState !== "object")
            return persistedState as DeckState;
          const state = persistedState as {
            currentDeckId?: string | null;
            savedDecks?: SavedDeck[];
          };
          return {
            ...state,
            currentDeckId: state.currentDeckId ?? null,
            savedDecks: (state.savedDecks ?? []).map((s) => ({
              ...s,
              deck: dropInlinePlaymat(migrateDeck(s.deck)),
            })),
          };
        },
        merge: (persisted, current) => {
          const p = (persisted ?? {}) as Partial<DeckState>;
          const merged = { ...current, ...p } as DeckState;
          merged.isReadOnly = false;
          merged.readOnlySource = null;
          merged.savedDecks = merged.savedDecks.map((saved) => ({
            ...saved,
            deck: normalizeDeck(dropInlinePlaymat(migrateDeck(saved.deck))),
          }));
          if (p.currentDeck && hasPendingEditorPublication()) {
            merged.currentDeck = normalizeDeck(dropInlinePlaymat(migrateDeck(p.currentDeck)));
            merged.currentDeckId = p.currentDeckId ?? null;
          } else {
            merged.currentDeck = { ...initialDeck };
            merged.currentDeckId = null;
          }
          return merged;
        },
        onRehydrateStorage: () => (_state, error) => {
          if (error) {
            useDeckStore.setState({ migrationError: true });
          } else {
            deckPersistReady = true;
            // Deferred: sync hydration fires this callback while the store is
            // still being created, before `useDeckStore` is assigned.
            queueMicrotask(() => void completeDeckMigrations(useDeckStore.getState()));
          }
        },
      },
    ),
    { name: "deck", enabled: import.meta.env.DEV },
  ),
);
