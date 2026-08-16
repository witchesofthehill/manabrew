import { describe, expect, it } from "vitest";

import { collectionCardKey } from "@/lib/collection";
import type { DeckCard } from "@/protocol/deck";
import type { ScryfallCard } from "@/types/scryfall";

import {
  allocateOwnedPrintings,
  cheapestCompatiblePrinting,
  supportsPrintingFinish,
} from "./printingOptimizer";

function card(id: string, setCode: string, cardNumber: string, foil = false): DeckCard {
  return {
    identity: { id, name: "Lightning Bolt", setCode, cardNumber, foil },
  } as DeckCard;
}

describe("allocateOwnedPrintings", () => {
  it("preserves owned exact copies and assigns remaining copies individually", () => {
    const assignments = allocateOwnedPrintings(
      [card("one", "lea", "161"), card("two", "lea", "161")],
      {
        [collectionCardKey("Lightning Bolt", "lea", "161", false)]: 1,
        [collectionCardKey("Lightning Bolt", "2xm", "117", true)]: 1,
      },
    );

    expect(assignments).toEqual([
      {
        cardId: "two",
        name: "Lightning Bolt",
        setCode: "2xm",
        collectorNumber: "117",
        foil: true,
      },
    ]);
  });

  it("does not propose a finish-only change for a legacy exact printing", () => {
    expect(
      allocateOwnedPrintings([card("one", "lea", "161")], {
        [collectionCardKey("Lightning Bolt", "lea", "161")]: 1,
      }),
    ).toEqual([]);
  });

  it("does not claim more owned copies than the collection contains", () => {
    expect(
      allocateOwnedPrintings([card("one", "lea", "161"), card("two", "lea", "161")], {
        [collectionCardKey("Lightning Bolt", "2xm", "117", false)]: 1,
      }),
    ).toHaveLength(1);
  });

  it("prefers an owned printing with the current finish", () => {
    expect(
      allocateOwnedPrintings([card("one", "lea", "161", true)], {
        [collectionCardKey("Lightning Bolt", "2xm", "117", false)]: 1,
        [collectionCardKey("Lightning Bolt", "clb", "401", true)]: 1,
      }),
    ).toEqual([
      {
        cardId: "one",
        name: "Lightning Bolt",
        setCode: "clb",
        collectorNumber: "401",
        foil: true,
      },
    ]);
  });
});

describe("cheapestCompatiblePrinting", () => {
  function printing(id: string, finishes: string[], prices: ScryfallCard["prices"]): ScryfallCard {
    return { id, finishes, prices } as ScryfallCard;
  }

  it("does not select a cheaper printing without the requested finish", () => {
    const nonfoilOnly = printing("nonfoil", ["nonfoil"], { usd: "1", usd_foil: "0.25" });
    const foil = printing("foil", ["foil"], { usd_foil: "2" });

    expect(cheapestCompatiblePrinting([nonfoilOnly, foil], "tcgplayer", true)?.id).toBe("foil");
  });

  it("requires a nonfoil finish when optimizing nonfoil cards", () => {
    const foilOnly = printing("foil", ["foil"], { tix: "0.01" });
    const nonfoil = printing("nonfoil", ["nonfoil"], { tix: "0.5" });

    expect(cheapestCompatiblePrinting([foilOnly, nonfoil], "cardhoarder", false)?.id).toBe(
      "nonfoil",
    );
  });

  it("rejects a nonfoil conversion for a foil-only printing", () => {
    const foilOnly = printing("foil", ["foil"], { usd_foil: "1" });

    expect(supportsPrintingFinish(foilOnly, false)).toBe(false);
    expect(supportsPrintingFinish(foilOnly, true)).toBe(true);
  });
});
