// @vitest-environment jsdom

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchCardCollection, fetchCardByFuzzyName } = vi.hoisted(() => ({
  fetchCardCollection: vi.fn(),
  fetchCardByFuzzyName: vi.fn(),
}));

vi.mock("@/api/scryfall", () => ({
  scryfallCardKey: (name: string, setCode?: string, collectorNumber?: string) =>
    [name, setCode, collectorNumber].filter(Boolean).join("::").toLowerCase(),
}));
vi.mock("@/stores/useScryfallStore", () => ({
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

  it("does not substitute a name-only result for an exact printing", async () => {
    fetchCardCollection.mockResolvedValue(
      new Map([["lightning bolt", { name: "Lightning Bolt" }]]),
    );

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
            collectorNumber: "161",
          },
        ],
        () => undefined,
      ),
    ).rejects.toThrow("None of the cards could be found");
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
});
