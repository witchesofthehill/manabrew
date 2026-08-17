import { afterAll, describe, expect, it, vi } from "vitest";

import { mergeDeckImportIntoDeck, parseDeckListText } from "./deckImport";
import type { DeckCard } from "@/protocol/deck";

vi.hoisted(() => vi.stubGlobal("__APP_VERSION__", "test"));

afterAll(() => vi.unstubAllGlobals());

function card(name: string): DeckCard {
  return { identity: { id: name, name, setCode: "tst", cardNumber: "1" }, uris: {} } as DeckCard;
}

describe("deck text import review data", () => {
  it("preserves destinations, exact printings, and foil finishes", () => {
    const entries = parseDeckListText(`Commander
1 Atraxa, Praetors' Voice (2X2) 190 *F*

Deck
2 Counterspell (MH2) 267

Sideboard
1 Negate (MOM) 68

Maybeboard
1 Arcane Denial`);

    expect(entries).toEqual([
      expect.objectContaining({
        name: "Atraxa, Praetors' Voice",
        commander: true,
        setCode: "2x2",
        collectorNumber: "190",
        foil: true,
      }),
      expect.objectContaining({
        name: "Counterspell",
        count: 2,
        side: false,
        setCode: "mh2",
        collectorNumber: "267",
      }),
      expect.objectContaining({ name: "Negate", side: true }),
      expect.objectContaining({ name: "Arcane Denial", maybe: true }),
    ]);
  });

  it("ignores malformed lines instead of creating partial cards", () => {
    expect(parseDeckListText("not a card\nLightning Bolt\n4 Counterspell")).toEqual([
      expect.objectContaining({ name: "Counterspell", count: 4 }),
    ]);
  });

  it("recognizes a commander-first headerless export", () => {
    const main = Array.from({ length: 99 }, (_, index) => `1 Main Card ${index + 1}`).join("\n");
    const entries = parseDeckListText(`1 Atraxa, Praetors' Voice\n\n${main}`);

    expect(entries[0]).toEqual(
      expect.objectContaining({ name: "Atraxa, Praetors' Voice", commander: true }),
    );
  });

  it("prefers a trailing commander block when both ends are singletons", () => {
    const main = Array.from({ length: 90 }, (_, index) => `1 Main Card ${index + 1}`).join("\n");
    const entries = parseDeckListText(`1 First Main Card\n\n${main}\n\n1 Atraxa, Praetors' Voice`);

    expect(entries[0].commander).toBe(false);
    expect(entries.at(-1)).toEqual(
      expect.objectContaining({ name: "Atraxa, Praetors' Voice", commander: true }),
    );
  });

  it("adopts commander identity when importing into a new deck", () => {
    const commander = card("Atraxa, Praetors' Voice");
    const merged = mergeDeckImportIntoDeck(
      { name: "New Deck", format: "standard", cards: [], sideboard: [] },
      { cards: [card("Sol Ring")], sideboard: [], maybeboard: [], commanders: [commander] },
    );

    expect(merged.name).toBe("Atraxa, Praetors' Voice");
    expect(merged.format).toBe("commander");
    expect(merged.commanders).toEqual([commander]);
    expect(merged.cards.map((entry) => entry.identity.name)).toEqual(["Sol Ring"]);
  });
});
