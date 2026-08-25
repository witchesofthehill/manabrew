import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => vi.stubGlobal("__APP_VERSION__", "test"));
vi.mock("pixi.js", () => ({
  ImageSource: class {},
  Texture: class {
    static EMPTY = {};
  },
}));

import { asDeckCard } from "@/lib/decks";
import type { Deck, DeckCard } from "@/protocol/deck";
import type { CardDto } from "@/protocol/game";

// A user-authored deck can carry a card with no images at all. The type says
// otherwise, so nothing catches it until the board renders and the Play view
// dies with "can't access property border_crop".
const imagelessDeck = {
  name: "hand written",
  cards: [
    {
      identity: { id: "1", name: "Lightning Bolt", setCode: "fca", cardNumber: "40" },
      manaCost: "{R}",
      cmc: 1,
      types: ["Instant"],
      subtypes: [],
      supertypes: [],
      color: "R",
      colorIdentity: ["R"],
      text: "",
    } as unknown as DeckCard,
  ],
  sideboard: [],
} as unknown as Deck;

const gameCard = {
  identity: { id: "engine-1", name: "Lightning Bolt", setCode: "fca", cardNumber: "40" },
} as unknown as CardDto;

describe("asDeckCard", () => {
  it("gives a card with no images an empty uris object", () => {
    const resolved = asDeckCard(imagelessDeck, gameCard);
    expect(resolved.identity.name).toBe("Lightning Bolt");
    expect(resolved.uris).toBeDefined();
    expect(resolved.uris.border_crop).toBeUndefined();
  });

  it("leaves a card that has images alone", () => {
    const withArt = {
      ...imagelessDeck,
      cards: [{ ...imagelessDeck.cards[0], uris: { border_crop: "art" } } as unknown as DeckCard],
    } as Deck;
    expect(asDeckCard(withArt, gameCard).uris.border_crop).toBe("art");
  });
});
