import { create } from "zustand";
import { persist, devtools } from "zustand/middleware";
import type { Deck, DeckCard, DeckFormatId } from "@/types/manabrew";
import type { ScryfallCard } from "@/types/scryfall";
import { STORAGE_KEYS, DEFAULT_DECK_NAME } from "@/lib/constants";
import { getFormat, canBePartners, canHaveAnyNumberOf, copyLimitFromText } from "@/lib/formats";
import { chooseImageUrisForCard } from "@/stores/useScryfallStore";
import { collectAllPartsNames } from "@/lib/decks";

/** Migrate legacy "constructed" format id to "standard". */
function migrateFormatId(id: string): DeckFormatId {
  if (id === "constructed") return "standard";
  return id as DeckFormatId;
}

function getCardUpdateKey(name: string, setCode?: string): string {
  return setCode ? `${name.toLowerCase()}::${setCode.toLowerCase()}` : name.toLowerCase();
}

/** Apply a map of name→patch to an array of cards. */
function patchCardsByName(cards: DeckCard[], updates: Map<string, Partial<DeckCard>>): DeckCard[] {
  return cards.map((c) => {
    const patch =
      updates.get(getCardUpdateKey(c.name, c.setCode)) ?? updates.get(getCardUpdateKey(c.name));
    return patch ? { ...c, ...patch } : c;
  });
}

/** Drop entries from `deck.tokens` whose name isn't produced by any remaining
 *  card's `allParts`. Called after every card removal so that a customized
 *  token print auto-cleans when its source leaves the deck. */
function pruneOrphanedTokens(deck: Deck): Deck {
  if (!deck.tokens || deck.tokens.length === 0) return deck;
  const produced = collectAllPartsNames(deck);
  const tokens = deck.tokens.filter((t) => produced.has(t.name.toLowerCase()));
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

function normalizeDeck(deck: Deck): Deck {
  const main = [...(deck.cards ?? [])];
  const sideboard = [...(deck.sideboard ?? [])];
  const attractions = [...(deck.attractions ?? [])];
  const contraptions = [...(deck.contraptions ?? [])];
  const schemes = [...(deck.schemes ?? [])];
  const planes = [...(deck.planes ?? [])];
  // Migrate legacy single-commander to commanders array
  const commanders = [...(deck.commanders ?? [])];
  const legacy = (deck as { commander?: DeckCard }).commander;
  if (legacy && !commanders.some((c) => c.name === legacy.name)) {
    commanders.push(legacy);
  }

  for (const cmd of commanders) {
    const idx = main.findIndex((card) => card.name === cmd.name);
    if (idx !== -1) main.splice(idx, 1);
  }

  const remainingSideboard: DeckCard[] = [];
  for (const card of sideboard) {
    if (isAttractionCard(card)) {
      attractions.push(card);
    } else if (isContraptionCard(card)) {
      contraptions.push(card);
    } else if (isSchemeCard(card)) {
      schemes.push(card);
    } else if (isPlaneCard(card)) {
      planes.push(card);
    } else {
      remainingSideboard.push(card);
    }
  }

  const normalized: Deck = {
    ...deck,
    format: migrateFormatId(deck.format ?? (commanders.length > 0 ? "commander" : "standard")),
    cards: main,
    sideboard: remainingSideboard,
    attractions,
    contraptions,
    schemes,
    planes,
    commanders: commanders.length > 0 ? commanders : undefined,
  };
  // Remove legacy field
  delete (normalized as { commander?: DeckCard }).commander;
  return normalized;
}

function patchDeckCards(deck: Deck, updates: Map<string, Partial<DeckCard>>): Deck {
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
      ? {
          ...normalized.companion,
          ...(updates.get(
            getCardUpdateKey(normalized.companion.name, normalized.companion.setCode),
          ) ??
            updates.get(getCardUpdateKey(normalized.companion.name)) ??
            {}),
        }
      : undefined,
    maybeboard: normalized.maybeboard
      ? patchCardsByName(normalized.maybeboard, updates)
      : undefined,
    tokens: normalized.tokens ? patchCardsByName(normalized.tokens, updates) : undefined,
  };
}

export interface SavedDeck {
  id: string;
  deck: Deck;
  savedAt: number;
}

interface DeckState {
  currentDeck: Deck;
  currentDeckId: string | null;
  /** True when browsing a preset — gates editing controls in DeckBuilder. */
  isReadOnly: boolean;
  pool: DeckCard[];
  savedDecks: SavedDeck[];
  addToMain: (card: DeckCard) => void;
  addToSide: (card: DeckCard) => void;
  addToMaybe: (card: DeckCard) => void;
  removeFromMaybe: (cardId: string) => void;
  addToPool: (card: DeckCard) => void;
  removeFromMain: (cardId: string) => void;
  removeFromSide: (cardId: string) => void;
  setDeckName: (name: string) => void;
  setDeckFormat: (format: DeckFormatId) => void;
  clearDeck: () => void;
  loadDeck: (deck: Deck) => void;
  loadPresetDeck: (deck: Deck) => void;
  importPresetToMyDecks: () => string | null;
  addSavedDeck: (deck: Deck) => string;
  saveCurrentDeck: () => void;
  saveDraft: () => void;
  loadSavedDeck: (id: string) => void;
  deleteSavedDeck: (id: string) => void;
  setCommander: (card: DeckCard) => void;
  removeCommander: (card?: DeckCard) => void;
  setCompanion: (card: DeckCard) => void;
  removeCompanion: () => void;
  updatePrint: (cardName: string, scryfallCard: ScryfallCard) => void;
  toggleFoil: (cardName: string) => void;
  addToken: (token: DeckCard) => void;
  removeToken: (name: string) => void;
  enrichDeckCards: (updates: Map<string, Partial<DeckCard>>) => void;
  addCardToSavedDeck: (id: string, card: DeckCard) => void;
  enrichSavedDeck: (id: string, updates: Map<string, Partial<DeckCard>>) => void;
  addCustomTag: (tag: string) => void;
  removeCustomTag: (tag: string) => void;
  tagCard: (cardName: string, tag: string) => void;
  untagCard: (cardName: string, tag: string) => void;
  addDeckLabel: (label: string, color?: string) => void;
  removeDeckLabel: (label: string) => void;
  updateDeckLabelColor: (label: string, color?: string) => void;
  setCoverCard: (name: string | undefined, face?: 0 | 1) => void;
  setStackPositions: (positions: Record<string, { x: number; y: number }>) => void;
}

const initialDeck: Deck = {
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
        isReadOnly: false,
        pool: [],
        savedDecks: [],
        addToMain: (card) =>
          set((state) => {
            // Enforce max copy limit based on deck format
            if (!canHaveAnyNumberOf(card)) {
              const format = getFormat(state.currentDeck.format ?? "standard");
              if (format) {
                const limit = copyLimitFromText(card.text) ?? format.deckRules.maxCopies;
                const currentCount = state.currentDeck.cards.filter(
                  (c) => c.name === card.name,
                ).length;
                if (currentCount >= limit) {
                  return state; // silently reject — UI will show toast via DeckBuilder
                }
              }
            }
            return {
              currentDeck: { ...state.currentDeck, cards: [...state.currentDeck.cards, card] },
            };
          }),
        addToSide: (card) =>
          set((state) => {
            const deck = normalizeDeck(state.currentDeck);
            if (isAttractionCard(card)) {
              return {
                currentDeck: { ...deck, attractions: [...(deck.attractions ?? []), card] },
              };
            }
            if (isContraptionCard(card)) {
              return {
                currentDeck: { ...deck, contraptions: [...(deck.contraptions ?? []), card] },
              };
            }
            if (isSchemeCard(card)) {
              return {
                currentDeck: { ...deck, schemes: [...(deck.schemes ?? []), card] },
              };
            }
            if (isPlaneCard(card)) {
              return {
                currentDeck: { ...deck, planes: [...(deck.planes ?? []), card] },
              };
            }
            return {
              currentDeck: { ...deck, sideboard: [...deck.sideboard, card] },
            };
          }),
        addToMaybe: (card) =>
          set((state) => ({
            currentDeck: {
              ...state.currentDeck,
              maybeboard: [...(state.currentDeck.maybeboard ?? []), card],
            },
          })),
        removeFromMaybe: (cardId) =>
          set((state) => {
            const idx = (state.currentDeck.maybeboard ?? []).findIndex((c) => c.id === cardId);
            if (idx === -1) return state;
            const maybeboard = [...(state.currentDeck.maybeboard ?? [])];
            maybeboard.splice(idx, 1);
            return { currentDeck: pruneOrphanedTokens({ ...state.currentDeck, maybeboard }) };
          }),
        addToPool: (card) =>
          set((state) => ({
            pool: [...state.pool, card],
          })),
        removeFromMain: (cardId) =>
          set((state) => {
            const index = state.currentDeck.cards.findIndex((c) => c.id === cardId);
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
            const sideIndex = deck.sideboard.findIndex((c) => c.id === cardId);
            if (sideIndex !== -1) {
              const sideboard = [...deck.sideboard];
              sideboard.splice(sideIndex, 1);
              return { currentDeck: pruneOrphanedTokens({ ...deck, sideboard }) };
            }
            const attractionIndex = (deck.attractions ?? []).findIndex((c) => c.id === cardId);
            if (attractionIndex !== -1) {
              const attractions = [...(deck.attractions ?? [])];
              attractions.splice(attractionIndex, 1);
              return { currentDeck: pruneOrphanedTokens({ ...deck, attractions }) };
            }
            const contraptionIndex = (deck.contraptions ?? []).findIndex((c) => c.id === cardId);
            if (contraptionIndex !== -1) {
              const contraptions = [...(deck.contraptions ?? [])];
              contraptions.splice(contraptionIndex, 1);
              return { currentDeck: pruneOrphanedTokens({ ...deck, contraptions }) };
            }
            const schemeIndex = (deck.schemes ?? []).findIndex((c) => c.id === cardId);
            if (schemeIndex !== -1) {
              const schemes = [...(deck.schemes ?? [])];
              schemes.splice(schemeIndex, 1);
              return { currentDeck: pruneOrphanedTokens({ ...deck, schemes }) };
            }
            const planeIndex = (deck.planes ?? []).findIndex((c) => c.id === cardId);
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
              // Move commanders back to main deck
              const movedBack = (deck.commanders ?? []).map((c) => ({
                ...c,
                id: crypto.randomUUID(),
              }));
              return {
                currentDeck: {
                  ...deck,
                  format,
                  cards: [...deck.cards, ...movedBack],
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
          set({ currentDeck: { ...initialDeck }, currentDeckId: null, isReadOnly: false }),
        loadDeck: (deck) => set({ currentDeck: normalizeDeck(deck), isReadOnly: false }),
        loadPresetDeck: (deck) =>
          set({
            currentDeck: normalizeDeck(deck),
            currentDeckId: null,
            isReadOnly: true,
          }),
        importPresetToMyDecks: () => {
          const state = get();
          const id = crypto.randomUUID();
          const baseName = state.currentDeck.name || DEFAULT_DECK_NAME;
          const importedName = baseName.endsWith(" (Copy)") ? baseName : `${baseName} (Copy)`;
          const imported: Deck = {
            ...normalizeDeck(state.currentDeck),
            name: importedName,
            id: undefined,
          };
          const savedDeck: SavedDeck = { id, deck: imported, savedAt: Date.now() };
          set((s) => ({
            currentDeck: imported,
            currentDeckId: id,
            isReadOnly: false,
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
        setCommander: (card) =>
          set((state) => {
            const deck = normalizeDeck(state.currentDeck);
            const nextMain = [...deck.cards];
            const selectedIndex = nextMain.findIndex((entry) => entry.id === card.id);
            const selectedCard =
              selectedIndex !== -1 ? nextMain.splice(selectedIndex, 1)[0] : { ...card };

            const commanders = [...(deck.commanders ?? [])];

            if (commanders.length >= 1) {
              if (!canBePartners(commanders[0], selectedCard)) {
                // New card can't partner with the existing commander — replace all
                for (const c of commanders.splice(0)) {
                  nextMain.push({ ...c, id: crypto.randomUUID() });
                }
              } else if (commanders.length >= 2) {
                // Valid partner pair but already have 2 — replace the second
                const removed = commanders.pop()!;
                nextMain.push({ ...removed, id: crypto.randomUUID() });
              }
            }

            commanders.push(selectedCard!);

            return {
              currentDeck: {
                ...deck,
                format: "commander",
                cards: nextMain,
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
              ? commanders.find((c) => c.name === card.name)
              : commanders[commanders.length - 1];
            if (!toRemove) return state;

            return {
              currentDeck: {
                ...deck,
                cards: [...deck.cards, { ...toRemove, id: crypto.randomUUID() }],
                commanders: commanders.filter((c) => c.name !== toRemove.name),
              },
            };
          }),
        setCompanion: (card) =>
          set((state) => {
            const deck = normalizeDeck(state.currentDeck);
            const nextSide = [...deck.sideboard];
            const idx = nextSide.findIndex((c) => c.id === card.id);
            const selected = idx !== -1 ? nextSide.splice(idx, 1)[0] : { ...card };

            // Move old companion back to sideboard
            if (deck.companion) {
              nextSide.push({ ...deck.companion, id: crypto.randomUUID() });
            }

            return {
              currentDeck: { ...deck, sideboard: nextSide, companion: selected },
            };
          }),
        removeCompanion: () =>
          set((state) => {
            const deck = normalizeDeck(state.currentDeck);
            if (!deck.companion) return state;
            return {
              currentDeck: {
                ...deck,
                sideboard: [...deck.sideboard, { ...deck.companion, id: crypto.randomUUID() }],
                companion: undefined,
              },
            };
          }),
        addToken: (token) =>
          set((state) => {
            const existing = state.currentDeck.tokens ?? [];
            if (existing.some((t) => t.name === token.name)) {
              return state;
            }
            return {
              currentDeck: { ...state.currentDeck, tokens: [...existing, token] },
            };
          }),
        removeToken: (name) =>
          set((state) => ({
            currentDeck: {
              ...state.currentDeck,
              tokens: (state.currentDeck.tokens ?? []).filter((t) => t.name !== name),
            },
          })),
        updatePrint: (cardName, scryfallCard) =>
          set((state) => {
            const uris = chooseImageUrisForCard(scryfallCard, { frontOnly: true });
            if (!uris) throw new Error(`Scryfall card has no image uris: ${scryfallCard.name}`);
            const updates = new Map<string, Partial<DeckCard>>();
            updates.set(cardName.toLowerCase(), {
              setCode: scryfallCard.set,
              uris,
              cardNumber: scryfallCard.collector_number,
            });
            return {
              currentDeck: patchDeckCards(state.currentDeck, updates),
            };
          }),
        toggleFoil: (cardName) =>
          set((state) => {
            const deck = normalizeDeck(state.currentDeck);
            const allCopies: DeckCard[] = [
              ...deck.cards,
              ...deck.sideboard,
              ...(deck.maybeboard ?? []),
              ...(deck.attractions ?? []),
              ...(deck.contraptions ?? []),
              ...(deck.schemes ?? []),
              ...(deck.planes ?? []),
              ...(deck.commanders ?? []),
            ];
            const matches = allCopies.filter((c) => c.name === cardName);
            const targetFoil = !matches.every((c) => c.foil);
            const flip = (cards: DeckCard[]): DeckCard[] =>
              cards.map((c) => (c.name === cardName ? { ...c, foil: targetFoil } : c));
            return {
              currentDeck: {
                ...deck,
                cards: flip(deck.cards),
                sideboard: flip(deck.sideboard),
                attractions: deck.attractions ? flip(deck.attractions) : deck.attractions,
                contraptions: deck.contraptions ? flip(deck.contraptions) : deck.contraptions,
                schemes: deck.schemes ? flip(deck.schemes) : deck.schemes,
                planes: deck.planes ? flip(deck.planes) : deck.planes,
                commanders: deck.commanders ? flip(deck.commanders) : deck.commanders,
                companion:
                  deck.companion && deck.companion.name === cardName
                    ? { ...deck.companion, foil: targetFoil }
                    : deck.companion,
                maybeboard: deck.maybeboard ? flip(deck.maybeboard) : deck.maybeboard,
              },
            };
          }),
        saveCurrentDeck: () =>
          set((state) => {
            // Clear draft flag on full save
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
              currentDeck: normalizeDeck(found.deck),
              currentDeckId: id,
              isReadOnly: false,
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
                    deck: { ...normalizeDeck(s.deck), cards: [...s.deck.cards, card] },
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
            const existing = state.currentDeck.customTags ?? [];
            if (existing.includes(tag)) return state;
            return {
              currentDeck: { ...state.currentDeck, customTags: [...existing, tag] },
            };
          }),
        removeCustomTag: (tag) =>
          set((state) => {
            const customTags = (state.currentDeck.customTags ?? []).filter((t) => t !== tag);
            const cardTags = { ...state.currentDeck.cardTags };
            for (const key of Object.keys(cardTags)) {
              cardTags[key] = cardTags[key].filter((t) => t !== tag);
              if (cardTags[key].length === 0) delete cardTags[key];
            }
            return {
              currentDeck: { ...state.currentDeck, customTags, cardTags },
            };
          }),
        tagCard: (cardName, tag) =>
          set((state) => {
            const key = cardName.toLowerCase();
            const cardTags = { ...state.currentDeck.cardTags };
            const tags = cardTags[key] ?? [];
            if (tags.includes(tag)) return state;
            cardTags[key] = [...tags, tag];
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
        setStackPositions: (positions) =>
          set((state) => ({
            currentDeck: { ...state.currentDeck, stackPositions: positions },
          })),
      }),
      {
        name: STORAGE_KEYS.DECK,
        version: 3,
        merge: (persisted, current) => {
          const merged = { ...current, ...(persisted as object) } as DeckState;
          merged.isReadOnly = false;
          merged.currentDeck = { ...initialDeck };
          merged.currentDeckId = null;
          return merged;
        },
        migrate: (persistedState: unknown) => {
          if (!persistedState || typeof persistedState !== "object")
            return persistedState as DeckState;
          const state = persistedState as {
            currentDeck?: Deck;
            currentDeckId?: string | null;
            savedDecks?: SavedDeck[];
          };
          return {
            ...state,
            currentDeckId: state.currentDeckId ?? null,
            currentDeck: normalizeDeck(state.currentDeck ?? initialDeck),
            savedDecks: (state.savedDecks ?? []).map((saved) => ({
              ...saved,
              deck: normalizeDeck(saved.deck),
            })),
          };
        },
      },
    ),
    { name: "deck", enabled: import.meta.env.DEV },
  ),
);
