// @vitest-environment jsdom

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScryfallCard } from "@/types/scryfall";

const { fetchCardCollection, fetchCardByFuzzyName } = vi.hoisted(() => ({
  fetchCardCollection: vi.fn(),
  fetchCardByFuzzyName: vi.fn(),
}));

vi.mock("@/api/scryfall", () => ({
  getScryfallManaCost: (card: ScryfallCard) => card.mana_cost,
  scryfallCardKey: (name: string, setCode?: string, collectorNumber?: string) =>
    [name, setCode, collectorNumber].filter(Boolean).join("::").toLowerCase(),
}));
vi.mock("@/stores/useScryfallStore", () => ({
  chooseImageUrisForCard: (card: ScryfallCard) => card.image_uris,
  useScryfallStore: {
    getState: () => ({ fetchCardCollection, fetchCardByFuzzyName }),
  },
}));
vi.mock("pixi.js", () => ({
  ImageSource: class {},
  Texture: class {
    static EMPTY = {};
  },
}));

let resolveDeckTextImport: typeof import("./useDeckTextImport").resolveDeckTextImport;

beforeAll(async () => {
  vi.stubGlobal("__APP_VERSION__", "test");
  ({ resolveDeckTextImport } = await import("./useDeckTextImport"));
});

afterAll(() => vi.unstubAllGlobals());

describe("deck text import printing resolution", () => {
  beforeEach(() => {
    fetchCardCollection.mockReset();
    fetchCardByFuzzyName.mockReset();
  });

  it("substitutes a name-only result when an exact printing is unavailable", async () => {
    fetchCardCollection
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map([["lightning bolt", scryfallCard("Lightning Bolt")]]));

    const result = await resolveDeckTextImport(
      [
        {
          name: "Lightning Bolt",
          count: 1,
          side: false,
          maybe: false,
          commander: false,
          setCode: "lea",
          collectorNumber: "161",
        },
      ],
      () => undefined,
    );

    expect(result.cards).toHaveLength(1);
    expect(result.substitutedPrintings).toEqual(["Lightning Bolt"]);
    expect(fetchCardByFuzzyName).not.toHaveBeenCalled();
  });

  it("does not use fuzzy fallback when a set-constrained lookup fails", async () => {
    fetchCardCollection.mockResolvedValue(new Map());
    fetchCardByFuzzyName.mockResolvedValue({ name: "Lightning Bolt", set: "2xm" });

    await expect(
      resolveDeckTextImport(
        [
          {
            name: "Lightning Bolt",
            count: 1,
            side: false,
            maybe: false,
            commander: false,
            setCode: "lea",
          },
        ],
        () => undefined,
      ),
    ).rejects.toThrow("None of the cards could be found");
    expect(fetchCardByFuzzyName).not.toHaveBeenCalled();
  });

  it("moves a legal first-card candidate into the command zone", async () => {
    const valgavoth = scryfallCard(
      "Valgavoth, Harrower of Souls",
      "Legendary Creature — Elder Demon",
    );
    fetchCardCollection.mockResolvedValue(new Map([["valgavoth, harrower of souls", valgavoth]]));

    const result = await resolveDeckTextImport(
      [
        {
          name: "Valgavoth, Harrower of Souls",
          count: 1,
          side: false,
          maybe: false,
          commander: false,
          commanderCandidate: true,
        },
      ],
      () => undefined,
    );

    expect(result.commanders.map((card) => card.identity.name)).toEqual([
      "Valgavoth, Harrower of Souls",
    ]);
    expect(result.cards).toHaveLength(0);
  });
});

function scryfallCard(name: string, typeLine = "Instant"): ScryfallCard {
  return {
    id: name,
    oracle_id: name,
    lang: "en",
    released_at: "2026-01-01",
    uri: "uri",
    scryfall_uri: "scryfall-uri",
    name,
    highres_image: true,
    image_status: "highres_scan",
    set: "tst",
    set_id: "test-set",
    set_name: "Test Set",
    set_type: "expansion",
    set_uri: "set-uri",
    set_search_uri: "set-search-uri",
    scryfall_set_uri: "scryfall-set-uri",
    rulings_uri: "rulings-uri",
    prints_search_uri: "prints-search-uri",
    collector_number: "1",
    type_line: typeLine,
    oracle_text: "",
    image_uris: {
      small: "small",
      normal: "normal",
      large: "large",
      png: "png",
      art_crop: "art",
      border_crop: "border",
    },
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: {},
    games: [],
    cmc: 1,
    layout: "normal",
    reserved: false,
    foil: false,
    nonfoil: true,
    finishes: ["nonfoil"],
    oversized: false,
    promo: false,
    reprint: false,
    variation: false,
    digital: false,
    rarity: "common",
    card_back_id: "card-back",
    artist: "Test Artist",
    artist_ids: [],
    illustration_id: "illustration",
    border_color: "black",
    frame: "2015",
    full_art: false,
    textless: false,
    booster: true,
    story_spotlight: false,
    prices: {},
    related_uris: {},
    purchase_uris: {},
  };
}
