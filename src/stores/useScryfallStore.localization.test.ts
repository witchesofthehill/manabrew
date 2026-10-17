import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScryfallCard } from "@/types/scryfall";

const scryfallMocks = vi.hoisted(() => ({
  fetchPrintsByOracleIds: vi.fn(),
  fetchCardCollection: vi.fn(),
  fetchCardsBySet: vi.fn(),
  fetchCardByFuzzyName: vi.fn(),
  fetchImageElement: vi.fn(),
  fetchSets: vi.fn(),
  getCardById: vi.fn(),
  getCardByName: vi.fn(),
  getCardBySetAndNumber: vi.fn(),
  getLocalizedCardPrinting: vi.fn(),
  getRulings: vi.fn(),
  searchCards: vi.fn(),
}));

vi.mock("pixi.js", () => ({
  ImageSource: class {},
  Texture: class {
    static EMPTY = {};
  },
}));

vi.mock("@/api/scryfall", () => ({
  fetchCardsBySet: scryfallMocks.fetchCardsBySet,
  fetchCardByFuzzyName: scryfallMocks.fetchCardByFuzzyName,
  fetchCardCollection: scryfallMocks.fetchCardCollection,
  fetchPrintsByOracleIds: scryfallMocks.fetchPrintsByOracleIds,
  fetchImageElement: scryfallMocks.fetchImageElement,
  fetchSets: scryfallMocks.fetchSets,
  getCardById: scryfallMocks.getCardById,
  getCardByName: scryfallMocks.getCardByName,
  getCardBySetAndNumber: scryfallMocks.getCardBySetAndNumber,
  getLocalizedCardPrinting: scryfallMocks.getLocalizedCardPrinting,
  getRulings: scryfallMocks.getRulings,
  searchCards: scryfallMocks.searchCards,
}));

vi.mock("@/platform", () => ({
  getPlatformType: () => "web",
}));

function printing(
  oracleId: string,
  set: string,
  collectorNumber: string,
  printedName: string,
  lang = "it",
): ScryfallCard {
  return {
    oracle_id: oracleId,
    id: `${set}-${collectorNumber}-${printedName}`,
    name: "Lightning Bolt",
    set,
    collector_number: collectorNumber,
    lang,
    type_line: "Instant",
    oracle_text: "Lightning Bolt deals 3 damage to any target.",
    printed_name: printedName,
    printed_type_line: "Istantaneo",
    printed_text: "Fulmine infligge 3 danni a qualsiasi bersaglio.",
    image_uris: { normal: `https://cards.test/${set}/${collectorNumber}.jpg` },
  } as ScryfallCard;
}

describe("localized card detail lookup", () => {
  beforeEach(() => {
    scryfallMocks.fetchPrintsByOracleIds.mockReset();
    scryfallMocks.fetchCardCollection.mockReset();
  });

  it("prefers the exact chosen printing over another translation of the same card", async () => {
    const { useScryfallStore } = await import("@/stores/useScryfallStore");
    scryfallMocks.fetchPrintsByOracleIds.mockResolvedValue(
      new Map([
        [
          "bolt",
          [
            printing("bolt", "m10", "146", "Fulmine alternativo"),
            printing("bolt", "lea", "161", "Fulmine"),
          ],
        ],
      ]),
    );

    const details = await useScryfallStore
      .getState()
      .getLocalizedCardDetails(
        [{ oracleId: "bolt", setCode: "lea", collectorNumber: "161" }],
        "it",
      );

    expect([...details.values()][0]?.name).toBe("Fulmine");
    expect(scryfallMocks.fetchPrintsByOracleIds).toHaveBeenCalledTimes(1);
    expect(scryfallMocks.fetchPrintsByOracleIds).toHaveBeenCalledWith(
      ["bolt"],
      undefined,
      undefined,
      "it",
    );
  });

  it("uses another printing's translated text when the selected printing has no translation", async () => {
    const { useScryfallStore } = await import("@/stores/useScryfallStore");
    scryfallMocks.fetchPrintsByOracleIds.mockResolvedValue(
      new Map([["bolt-any", [printing("bolt-any", "m10", "147", "Fulmine")]]]),
    );

    const details = await useScryfallStore
      .getState()
      .getLocalizedCardDetails(
        [{ oracleId: "bolt-any", setCode: "lea", collectorNumber: "162" }],
        "it",
      );

    expect([...details.values()][0]?.name).toBe("Fulmine");
    expect([...details.values()][0]?.text).toContain("danni");
  });

  it("resolves legacy deck identities without an oracle ID in one exact-print batch", async () => {
    const { useScryfallStore } = await import("@/stores/useScryfallStore");
    scryfallMocks.fetchCardCollection.mockResolvedValue(
      new Map([["lightning bolt::2ed::179", printing("legacy-bolt", "2ed", "179", "Fulmine")]]),
    );
    scryfallMocks.fetchPrintsByOracleIds.mockResolvedValue(
      new Map([["legacy-bolt", [printing("legacy-bolt", "2ed", "179", "Fulmine")]]]),
    );

    const details = await useScryfallStore
      .getState()
      .getLocalizedCardDetails(
        [{ name: "Lightning Bolt", setCode: "2ed", collectorNumber: "179" }],
        "it",
      );

    expect([...details.values()][0]?.name).toBe("Fulmine");
    expect(scryfallMocks.fetchCardCollection).toHaveBeenCalledTimes(1);
    expect(scryfallMocks.fetchCardCollection).toHaveBeenCalledWith([
      { name: "Lightning Bolt", setCode: "2ed", collectorNumber: "179" },
    ]);
  });

  it("serves warm localized details without another Scryfall request", async () => {
    const { useScryfallStore } = await import("@/stores/useScryfallStore");
    scryfallMocks.fetchPrintsByOracleIds.mockResolvedValue(
      new Map([["warm-bolt", [printing("warm-bolt", "tmp", "201", "Fulmine caldo")]]]),
    );
    const lookup = [{ oracleId: "warm-bolt", setCode: "tmp", collectorNumber: "201" }];

    const first = await useScryfallStore.getState().getLocalizedCardDetails(lookup, "it");
    scryfallMocks.fetchPrintsByOracleIds.mockClear();
    const warm = await useScryfallStore.getState().getLocalizedCardDetails(lookup, "it");

    expect([...warm.values()][0]).toEqual([...first.values()][0]);
    expect(scryfallMocks.fetchPrintsByOracleIds).not.toHaveBeenCalled();
  });

  it("clears failed in-flight lookups so transient errors can be retried", async () => {
    const { useScryfallStore } = await import("@/stores/useScryfallStore");
    const lookup = [{ oracleId: "retry-bolt", setCode: "tmp", collectorNumber: "202" }];
    scryfallMocks.fetchPrintsByOracleIds.mockRejectedValueOnce(new Error("network unavailable"));

    const failed = await useScryfallStore.getState().getLocalizedCardDetails(lookup, "it");
    expect([...failed.values()][0]).toBeNull();
    scryfallMocks.fetchPrintsByOracleIds.mockResolvedValueOnce(
      new Map([["retry-bolt", [printing("retry-bolt", "tmp", "202", "Fulmine")]]]),
    );

    const retried = await useScryfallStore.getState().getLocalizedCardDetails(lookup, "it");
    expect([...retried.values()][0]?.name).toBe("Fulmine");
    expect(scryfallMocks.fetchPrintsByOracleIds).toHaveBeenCalledTimes(2);
  });

  it("falls back to English display metadata and deduplicates concurrent lookups", async () => {
    const { useScryfallStore } = await import("@/stores/useScryfallStore");
    scryfallMocks.fetchPrintsByOracleIds.mockImplementation((_ids, _progress, _signal, lang) =>
      lang === "it"
        ? Promise.reject(new Error("Failed to fetch card printings from Scryfall (HTTP 404)"))
        : Promise.resolve(
            new Map([["bolt-none", [printing("bolt-none", "exo", "42", "Fulmine", "en")]]]),
          ),
    );
    const lookup = [{ oracleId: "bolt-none", setCode: "exo", collectorNumber: "42" }];

    const first = useScryfallStore.getState().getLocalizedCardDetails(lookup, "it");
    const second = useScryfallStore.getState().getLocalizedCardDetails(lookup, "it");

    const [firstDetails, secondDetails] = await Promise.all([first, second]);
    expect([...firstDetails.values()][0]?.name).toBe("Lightning Bolt");
    expect([...firstDetails.values()][0]?.text).toBe(
      "Lightning Bolt deals 3 damage to any target.",
    );
    expect([...firstDetails.values()][0]?.imageUris?.normal).toBe("https://cards.test/exo/42.jpg");
    expect([...secondDetails.values()][0]?.name).toBe("Lightning Bolt");
    expect(scryfallMocks.fetchPrintsByOracleIds).toHaveBeenCalledTimes(2);
  });

  it("continues later locale batches after a 404 and only fetches English for the empty batch", async () => {
    const { useScryfallStore } = await import("@/stores/useScryfallStore");
    const oracleIds = Array.from({ length: 21 }, (_, index) => `chunk-bolt-${index}`);
    const lookups = oracleIds.map((oracleId, index) => ({
      oracleId,
      setCode: "chunk",
      collectorNumber: String(index + 1),
    }));
    scryfallMocks.fetchPrintsByOracleIds.mockImplementation(
      (ids: string[], _progress: unknown, _signal: unknown, lang: string) => {
        if (lang === "it" && ids.length === 20) {
          return Promise.reject(
            new Error("Failed to fetch card printings from Scryfall (HTTP 404)"),
          );
        }
        if (lang === "it") {
          const id = ids[0];
          return Promise.resolve(
            new Map([[id, [printing(id, "chunk", "21", "Fulmine localizzato")]]]),
          );
        }
        return Promise.resolve(
          new Map(
            ids.map((id, index) => [
              id,
              [printing(id, "chunk", String(index + 1), `English ${index + 1}`, "en")],
            ]),
          ),
        );
      },
    );

    const details = await useScryfallStore.getState().getLocalizedCardDetails(lookups, "it");

    expect(details.get("it::chunk::1")?.name).toBe("Lightning Bolt");
    expect(details.get("it::chunk::21")?.name).toBe("Fulmine localizzato");
    expect(scryfallMocks.fetchPrintsByOracleIds).toHaveBeenCalledTimes(3);
    expect(
      scryfallMocks.fetchPrintsByOracleIds.mock.calls.map(([ids, , , lang]) => [ids.length, lang]),
    ).toEqual([
      [20, "it"],
      [1, "it"],
      [20, "en"],
    ]);
  });
});
