import { describe, expect, it } from "vitest";
import { deckCardNames } from "@forge-wasm/deckCards.js";

const card = (name: string) => ({ identity: { name } });

describe("deckCardNames", () => {
  it("reads every zone a card can enter the game from", () => {
    const names = deckCardNames([
      {
        cards: [card("Lightning Bolt")],
        commanders: [card("Najeela, the Blade-Blossom")],
        sideboard: [card("Pyroblast")],
        attractions: [card("Balloon Stand")],
        contraptions: [card("Accessories to Murder")],
        schemes: [card("All in Good Time")],
        planes: [card("Academy at Tolaria West")],
        companion: card("Lurrus of the Dream-Den"),
      },
    ]);

    expect(names).toEqual([
      "Lightning Bolt",
      "Najeela, the Blade-Blossom",
      "Pyroblast",
      "Balloon Stand",
      "Accessories to Murder",
      "All in Good Time",
      "Academy at Tolaria West",
      "Lurrus of the Dream-Den",
    ]);
  });

  it("asks for a double-faced card under both spellings", () => {
    // The archive may key it either way and a miss is silent, so send both.
    expect(deckCardNames([{ cards: [card("Delver of Secrets // Insectile Aberration")] }])).toEqual(
      ["Delver of Secrets // Insectile Aberration", "Delver of Secrets"],
    );
  });

  it("deduplicates across decks and skips seats with no deck", () => {
    const deck = { cards: [card("Island"), card("Island")] };
    expect(deckCardNames([deck, undefined, deck])).toEqual(["Island"]);
  });

  it("ignores entries with no name rather than asking for an empty script", () => {
    expect(deckCardNames([{ cards: [{ identity: { name: "" } }, {}] }])).toEqual([]);
  });
});
