import { afterAll, describe, expect, it, vi } from "vitest";

import { mergeDeckImportIntoDeck, parseDeckListText, suggestedDeckName } from "./deckImport";
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

  it("recognizes a plain foil marker after an exact printing", () => {
    expect(parseDeckListText("1 Kona, Rescue Beastie (DSK) 358 F")).toEqual([
      expect.objectContaining({
        name: "Kona, Rescue Beastie",
        setCode: "dsk",
        collectorNumber: "358",
        foil: true,
      }),
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
    expect(suggestedDeckName(entries)).toBe("Atraxa, Praetors' Voice");
  });

  it("recognizes the commander in the printing export from Moxfield deck 5Ou3mB9KDEmU-kIAbQHznA", () => {
    const main = [
      "1 Boggart Trawler / Boggart Bog (MH3) 243",
      "1 Malakir Rebirth / Malakir Mire (ZNR) 111",
      ...Array.from({ length: 74 }, (_, index) => `1 Main Card ${index + 1} (TST) ${index + 1}`),
      "13 Mountain (DSK) 283",
      "10 Swamp (DSK) 282",
    ].join("\n");
    const entries = parseDeckListText(`1 Valgavoth, Harrower of Souls (DSC) 6 *F*\n${main}`);

    expect(entries.reduce((sum, entry) => sum + entry.count, 0)).toBe(100);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        name: "Valgavoth, Harrower of Souls",
        commander: false,
        commanderCandidate: true,
        foil: true,
      }),
    );
    expect(suggestedDeckName(entries)).toBe("Valgavoth, Harrower of Souls");
    expect(entries.slice(1, 3).map((entry) => entry.name)).toEqual([
      "Boggart Trawler / Boggart Bog",
      "Malakir Rebirth / Malakir Mire",
    ]);
  });

  it("recognizes Archidekt categories from public deck 14863038", () => {
    const entries = parseDeckListText(`1x Ulalek, Fused Atrocity (M3C) 4 [Commander]
1x Eldrazi Displacer (OGW) 13 [Mainboard]
1x Path of Annihilation (M3C) 8 [Ramp]
1x Ulamog, the Ceaseless Hunger (BFZ) 15 [Maybeboard]`);

    expect(entries).toEqual([
      expect.objectContaining({ name: "Ulalek, Fused Atrocity", commander: true }),
      expect.objectContaining({ name: "Eldrazi Displacer", commander: false, maybe: false }),
      expect.objectContaining({ name: "Path of Annihilation", commander: false }),
      expect.objectContaining({ name: "Ulamog, the Ceaseless Hunger", maybe: true }),
    ]);
  });

  it("parses Archidekt category modifiers and collector number variants", () => {
    const entries = parseDeckListText(`Commander
1x Witherbloom, the Balancer (psos) 245p [Commander{top}]

Mainboard
1x Boreal Druid (csp) 105 *F* [Creature] ^Buy,#0066ff^
1x Studious First-Year // Rampant Growth (sos) 162 [Creature]
1x Ambition's Cost (plst) C15-113 [Draw]
1x Skullclamp (td0) A120 [Draw]
1x Fyndhorn Elves (wc97) sg244 [Ramp]
1x Rude Awakening (wc04) jn92sb [Ramp]
6x Forest (dft) 291 [Land]

Maybeboard
1x Boseiju, Who Endures (neo) 266 *F* [Maybeboard{noDeck}{noPrice},Land]

Sideboard
1x Arasta of the Endless Web (thb) 165 [Sideboard{noPrice}]`);

    expect(entries.reduce((sum, entry) => sum + entry.count, 0)).toBe(15);
    expect(entries[0]).toEqual(
      expect.objectContaining({
        name: "Witherbloom, the Balancer",
        commander: true,
        setCode: "psos",
        collectorNumber: "245p",
      }),
    );
    expect(entries[1]).toEqual(
      expect.objectContaining({ name: "Boreal Druid", foil: true, commander: false }),
    );
    expect(entries[2].name).toBe("Studious First-Year // Rampant Growth");
    expect(entries.slice(3, 7).map((entry) => entry.collectorNumber)).toEqual([
      "C15-113",
      "A120",
      "sg244",
      "jn92sb",
    ]);
    expect(entries[7]).toEqual(expect.objectContaining({ name: "Forest", count: 6 }));
    expect(entries[8]).toEqual(
      expect.objectContaining({ name: "Boseiju, Who Endures", maybe: true, foil: true }),
    );
    expect(entries[9]).toEqual(
      expect.objectContaining({ name: "Arasta of the Endless Web", side: true }),
    );
  });

  it("recognizes the headed export documented by Archidekt", () => {
    const entries = parseDeckListText(`Commander
1 Teval, the Balanced Scale (TDC) 8

Deck
1 Agadeem's Awakening / Agadeem, the Undercrypt (ZNR) 90
1 Fell the Profane / Fell Mire (MH3) 244`);

    expect(entries[0]).toEqual(
      expect.objectContaining({ name: "Teval, the Balanced Scale", commander: true }),
    );
    expect(entries.slice(1).map((entry) => entry.name)).toEqual([
      "Agadeem's Awakening / Agadeem, the Undercrypt",
      "Fell the Profane / Fell Mire",
    ]);
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
