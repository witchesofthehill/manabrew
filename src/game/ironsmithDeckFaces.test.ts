import { describe, expect, it, vi } from "vitest";
import type { Deck, DeckCard } from "@/protocol/deck";
import { needsBothCardParts, withBothCardParts } from "./ironsmithDeckFaces";

function card(name: string, extra: Partial<DeckCard> = {}): DeckCard {
  return {
    identity: { id: name, name, setCode: "tst", cardNumber: "1" },
    uris: {},
    color: "",
    colorIdentity: [],
    manaCost: "",
    cmc: 0,
    types: [],
    subtypes: [],
    supertypes: [],
    text: "",
    ...extra,
  } as DeckCard;
}

function deck(extra: Partial<Deck>): Deck {
  return { id: "d", name: "d", cards: [], sideboard: [], ...extra } as Deck;
}

const partsOf = (c: DeckCard) => (c as DeckCard & { cardFaces?: unknown[] }).cardFaces;

describe("Ironsmith deck card parts", () => {
  it("asks for both parts of every two-part layout", () => {
    expect(needsBothCardParts(card("Delver of Secrets", { isDoubleFaced: true }))).toBe(true);
    for (const layout of ["split", "adventure", "prepare", "flip"]) {
      expect(needsBothCardParts(card("Two Parts", { layout }))).toBe(true);
    }
    expect(needsBothCardParts(card("Lightning Bolt", { layout: "normal" }))).toBe(false);
    expect(needsBothCardParts(card("Lightning Bolt"))).toBe(false);
  });

  it("attaches both parts in every deck section and leaves other cards alone", async () => {
    const faces = [{ name: "Fire" }, { name: "Ice" }];
    const lookup = vi.fn(async () => faces);
    const bolt = card("Lightning Bolt", { layout: "normal" });
    const enriched = await withBothCardParts(
      deck({
        cards: [card("Fire", { layout: "split" }), bolt],
        sideboard: [card("Wear", { layout: "split" })],
        commanders: [card("Bonecrusher Giant", { layout: "adventure" })],
        companion: card("Emeritus of Woe", { layout: "prepare" }),
      }),
      lookup,
    );
    expect(partsOf(enriched.cards[0])).toBe(faces);
    expect(enriched.cards[1]).toBe(bolt);
    expect(partsOf(enriched.sideboard[0])).toBe(faces);
    expect(partsOf(enriched.commanders![0])).toBe(faces);
    expect(partsOf(enriched.companion!)).toBe(faces);
    expect(lookup).toHaveBeenCalledTimes(4);
  });

  it("keeps the card as stored when the lookup fails or has one part", async () => {
    const fire = card("Fire", { layout: "split" });
    const wear = card("Wear", { layout: "split" });
    const enriched = await withBothCardParts(deck({ cards: [fire, wear] }), async (c) => {
      if (c === fire) throw new Error("offline");
      return [{ name: "Wear" }];
    });
    expect(enriched.cards).toEqual([fire, wear]);
  });
});
