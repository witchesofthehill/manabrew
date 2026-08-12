import { describe, expect, it } from "vitest";

import type { DeckCard } from "@/protocol/deck";
import { exportToArena, exportWithPrintings } from "./deckExport";

function card(name: string, setCode: string, cardNumber: string, foil = false): DeckCard {
  return {
    identity: { id: crypto.randomUUID(), name, setCode, cardNumber, foil },
  } as DeckCard;
}

describe("deck exports", () => {
  it("includes commander and maybeboard sections", () => {
    const result = exportToArena({
      name: "Test",
      cards: [card("Lightning Bolt", "2xm", "125")],
      sideboard: [],
      commanders: [card("Niv-Mizzet, Parun", "grn", "192")],
      maybeboard: [card("Counterspell", "2xm", "47")],
    });

    expect(result).toContain("Commander\n1 Niv-Mizzet, Parun");
    expect(result).toContain("Maybeboard\n1 Counterspell");
  });

  it("keeps exact printing and foil variants separate", () => {
    const result = exportWithPrintings({
      cards: [
        card("Cast Down", "cmr", "112"),
        card("Cast Down", "clb", "119"),
        card("Cast Down", "clb", "119", true),
      ],
      sideboard: [],
    });

    expect(result).toContain("1 Cast Down (CMR) 112");
    expect(result).toContain("1 Cast Down (CLB) 119\n");
    expect(result).toContain("1 Cast Down (CLB) 119 *F*");
  });

  it("includes special sections in exact printing exports", () => {
    const result = exportWithPrintings({
      cards: [],
      sideboard: [],
      attractions: [card("Pick-a-Beeble", "unf", "190")],
      schemes: [card("All in Good Time", "oe01", "1")],
    });

    expect(result).toContain("Attractions\n1 Pick-a-Beeble (UNF) 190");
    expect(result).toContain("Schemes\n1 All in Good Time (OE01) 1");
  });
});
