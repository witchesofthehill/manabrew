import { describe, expect, it, vi } from "vitest";
import type { DeckCard } from "@/protocol/deck";

vi.mock("@/api/scryfall", () => ({ getScryfallManaCost: () => "" }));
vi.mock("@/stores/useScryfallStore", () => ({ chooseImageUrisForCard: () => ({}) }));

describe("localized card preview identity", () => {
  it("changes only preview copy while preserving the underlying deck-card identity", async () => {
    const { localizedDeckCardToPreviewDto, previewDtoDeckCard } =
      await import("@/lib/scryfall.utils");
    const card = {
      identity: {
        id: "deck-print-7",
        name: "Lightning Bolt",
        setCode: "lea",
        cardNumber: "161",
        oracleId: "bolt",
        foil: true,
      },
      color: "R",
      colorIdentity: ["R"],
      manaCost: "R",
      cmc: 1,
      types: ["Instant"],
      subtypes: [],
      supertypes: [],
      text: "Lightning Bolt deals 3 damage to any target.",
      uris: { small: "", normal: "", large: "", png: "", art_crop: "", border_crop: "" },
    } as unknown as DeckCard;

    const preview = localizedDeckCardToPreviewDto(card, {
      name: "Fulmine",
      typeLine: "Istantaneo",
      text: "Fulmine infligge 3 danni a qualsiasi bersaglio.",
    });

    expect(preview.identity.name).toBe("Fulmine");
    expect(preview.id).toBe("deck-print-7");
    expect(preview.identity.setCode).toBe("lea");
    expect(preview.identity.cardNumber).toBe("161");
    expect(preview.text).toContain("danni");
    expect(previewDtoDeckCard(preview)).toBe(card);
  });
});
