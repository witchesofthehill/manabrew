import { afterAll, describe, expect, it, vi } from "vitest";
import { buildDeckSnapshot } from "./deckBuilder.unsavedChanges";
import type { DeckCard } from "@/protocol/deck";
import type { EditorDeck } from "@/types/manabrew";

vi.hoisted(() => vi.stubGlobal("__APP_VERSION__", "test"));
vi.mock("pixi.js", () => ({
  ImageSource: class {},
  Texture: class {
    static EMPTY = {};
  },
}));

afterAll(() => vi.unstubAllGlobals());

function card(overrides: Partial<DeckCard> = {}): DeckCard {
  return {
    identity: { id: "card-1", name: "Forest", setCode: "eoe", cardNumber: "266" },
    uris: {},
    color: "",
    colorIdentity: [],
    manaCost: "",
    cmc: 0,
    types: ["Land"],
    subtypes: ["Forest"],
    supertypes: ["Basic"],
    text: "",
    ...overrides,
  } as DeckCard;
}

function deck(deckCard: DeckCard): EditorDeck {
  return { name: "Deck", format: "standard", cards: [deckCard], sideboard: [] };
}

const fetchedUris = {
  small: "https://example.test/small.jpg",
  normal: "https://example.test/normal.jpg",
  large: "https://example.test/large.jpg",
  png: "https://example.test/card.png",
  art_crop: "https://example.test/art.jpg",
  border_crop: "https://example.test/card.jpg",
};

describe("deck editor saved snapshots", () => {
  it("ignores fetched card metadata", () => {
    const original = card();
    const enriched = card({
      uris: fetchedUris,
      allParts: [],
      backFace: {
        name: "Back",
        manaCost: "",
        typeLine: "Land",
        oracleText: "",
        uris: fetchedUris,
      },
    });

    expect(buildDeckSnapshot(deck(enriched))).toBe(buildDeckSnapshot(deck(original)));
  });

  it("tracks printing and foil changes", () => {
    const original = card();
    const changed = card({
      identity: { ...original.identity, setCode: "dsk", cardNumber: "1", foil: true },
    });

    expect(buildDeckSnapshot(deck(changed))).not.toBe(buildDeckSnapshot(deck(original)));
  });
});
