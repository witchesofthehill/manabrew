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
});
