import { describe, expect, it, vi } from "vitest";
import type { ScryfallCard } from "@/types/scryfall";

vi.mock("@/api/scryfall", () => ({ getScryfallManaCost: () => "R" }));
vi.mock("@/stores/useScryfallStore", () => ({
  chooseImageUrisForCard: () => ({
    small: "small.jpg",
    normal: "normal.jpg",
    large: "large.jpg",
    png: "card.png",
    art_crop: "art.jpg",
    border_crop: "border.jpg",
  }),
}));

describe("localized Scryfall search results", () => {
  it("shows the localized print name while keeping the canonical deck identity", async () => {
    const { scryfallToSearchResult } = await import("@/lib/scryfall.utils");
    const card = {
      id: "printing-id",
      name: "Lightning Bolt",
      printed_name: "Fulmine",
      set: "lea",
      collector_number: "161",
      oracle_id: "oracle-id",
      lang: "it",
      type_line: "Instant",
      colors: ["R"],
      color_identity: ["R"],
      cmc: 1,
    } as ScryfallCard;

    const result = scryfallToSearchResult(card, "it");

    expect(result.displayName).toBe("Fulmine");
    expect(result.card.identity.name).toBe("Lightning Bolt");
    expect(result.card.identity.id).toBe("printing-id");
  });

  it("falls back to the canonical name when Scryfall has no printed name", async () => {
    const { scryfallToSearchResult } = await import("@/lib/scryfall.utils");
    const card = {
      id: "printing-id",
      name: "Lightning Bolt",
      set: "lea",
      collector_number: "161",
      oracle_id: "oracle-id",
      lang: "en",
      type_line: "Instant",
      colors: ["R"],
      color_identity: ["R"],
      cmc: 1,
    } as ScryfallCard;

    const result = scryfallToSearchResult(card);

    expect(result.displayName).toBe("Lightning Bolt");
    expect(result.card.identity.name).toBe("Lightning Bolt");
  });

  it("falls back to the canonical name when only a different-language print is available", async () => {
    const { scryfallToSearchResult } = await import("@/lib/scryfall.utils");
    const card = {
      id: "printing-id",
      name: "Lightning Bolt",
      printed_name: "Fulmine",
      set: "lea",
      collector_number: "161",
      oracle_id: "oracle-id",
      lang: "it",
      type_line: "Instant",
      colors: ["R"],
      color_identity: ["R"],
      cmc: 1,
    } as ScryfallCard;

    const result = scryfallToSearchResult(card, "es");

    expect(result.displayName).toBe("Lightning Bolt");
    expect(result.card.identity.name).toBe("Lightning Bolt");
  });

  it("uses the requested printing name when an explicit language filter is retained", async () => {
    const { scryfallToSearchResult } = await import("@/lib/scryfall.utils");
    const card = {
      id: "printing-id",
      name: "Lightning Bolt",
      printed_name: "Fulmine",
      set: "lea",
      collector_number: "161",
      oracle_id: "oracle-id",
      lang: "it",
      type_line: "Instant",
      colors: ["R"],
      color_identity: ["R"],
      cmc: 1,
    } as ScryfallCard;

    const result = scryfallToSearchResult(card, "es", true);

    expect(result.displayName).toBe("Fulmine");
    expect(result.card.identity.name).toBe("Lightning Bolt");
  });
});
