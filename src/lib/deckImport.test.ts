import { describe, expect, it } from "vitest";

import { parseDeckListText } from "./deckImport";

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
});
