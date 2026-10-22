import { afterEach, describe, expect, it, vi } from "vitest";
import { searchCards } from "@/api/scryfall";

vi.mock("@/lib/platformFetch", () => ({
  platformFetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
}));
vi.mock("@/platform", () => ({ getPlatformType: () => "web" }));
vi.mock("@/lib/scryfallImageSource", () => ({ loadScryfallImage: vi.fn() }));
vi.mock("@/lib/localCardRecords", () => ({
  localCardNames: vi.fn(async () => null),
  localCardRecord: vi.fn(async () => null),
  localCardRecords: vi.fn(async () => new Map()),
  localRulings: vi.fn(async () => null),
  localSets: vi.fn(async () => null),
}));
vi.mock("@/lib/scryfallAssets", () => ({
  scryfallAssetUrl: (url: string) => url,
  scryfallAssetsMirrored: false,
}));
vi.mock("@/api/scryfallBatch", () => ({
  enqueueCardLookup: vi.fn(),
  matchesIdentifier: vi.fn(),
  normalizeIdentifierForRequest: vi.fn(),
}));

describe("Scryfall localized-name search", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("searches all print languages for a typed card name", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({ object: "list", total_cards: 0, has_more: false, data: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    await searchCards("Fulmine");

    expect(new URL(requestedUrl).searchParams.get("q")).toBe("Fulmine lang:any");
  });

  it("preserves an explicit Scryfall language filter", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({ object: "list", total_cards: 0, has_more: false, data: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    await searchCards("Lightning Bolt lang:it");

    expect(new URL(requestedUrl).searchParams.get("q")).toBe("Lightning Bolt lang:it");
  });

  it("preserves language aliases and negated filters inside groups", async () => {
    let requestedUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({ object: "list", total_cards: 0, has_more: false, data: [] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );

    await searchCards("Lightning Bolt (language:it or -lang:es)");

    expect(new URL(requestedUrl).searchParams.get("q")).toBe(
      "Lightning Bolt (language:it or -lang:es)",
    );
  });
});
