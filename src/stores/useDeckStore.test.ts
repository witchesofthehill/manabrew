// @vitest-environment jsdom

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DeckCard } from "@/protocol/deck";
import type { ScryfallCard } from "@/types/scryfall";

vi.hoisted(() => vi.stubGlobal("__APP_VERSION__", "test"));
vi.mock("pixi.js", () => ({
  ImageSource: class {},
  Texture: class {
    static EMPTY = {};
  },
}));

let useDeckStore: typeof import("./useDeckStore").useDeckStore;

function card(id: string, setCode: string, cardNumber: string, foil = false): DeckCard {
  return {
    identity: { id, name: "Cast Down", setCode, cardNumber, foil },
    uris: {},
  } as DeckCard;
}

beforeAll(async () => {
  ({ useDeckStore } = await import("./useDeckStore"));
});

afterAll(() => vi.unstubAllGlobals());

describe("deck printing updates", () => {
  it("changes only copies of the selected printing variant", () => {
    const selected = card("selected-1", "cmr", "112", true);
    const selectedCopy = card("selected-2", "cmr", "112", true);
    const other = card("other", "clb", "119");
    useDeckStore.setState({
      currentDeck: {
        name: "Deck",
        format: "commander",
        cards: [selected, selectedCopy, other],
        sideboard: [],
      },
    });
    const print = {
      name: "Cast Down",
      set: "dom",
      collector_number: "81",
      oracle_id: "oracle",
      finishes: ["nonfoil"],
      image_uris: {
        small: "small",
        normal: "normal",
        large: "large",
        png: "png",
        art_crop: "art",
        border_crop: "border",
      },
    } as ScryfallCard;

    useDeckStore.getState().updatePrintingVariant(selected.identity, print);

    expect(
      useDeckStore.getState().currentDeck.cards.map((entry) => ({
        id: entry.identity.id,
        setCode: entry.identity.setCode,
        cardNumber: entry.identity.cardNumber,
        foil: !!entry.identity.foil,
      })),
    ).toEqual([
      { id: "selected-1", setCode: "dom", cardNumber: "81", foil: false },
      { id: "selected-2", setCode: "dom", cardNumber: "81", foil: false },
      { id: "other", setCode: "clb", cardNumber: "119", foil: false },
    ]);
  });
});
