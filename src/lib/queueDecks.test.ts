import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Deck } from "@/protocol/deck";

const fixture = vi.hoisted(() => ({
  findMyCombos: vi.fn(),
  unavailable: false,
}));

vi.mock("@/lib/gameChangers", () => ({
  normalizeCardName: (name: string) => name.split(" // ")[0].trim().toLowerCase(),
  fetchGameChangers: async () => new Set(["mana crypt"]),
}));
vi.mock("@/api/commanderSpellbook", () => ({ findMyCombos: fixture.findMyCombos }));
vi.mock("@/api/edhrec", () => ({
  fetchComboVotes: async () => ({ votes: new Map(), unavailable: fixture.unavailable }),
}));

const KEY = "manabrew-deck-brackets";

function deck(...names: string[]): Deck {
  const card = (name: string) => ({ identity: { name, setCode: "x", cardNumber: "1" }, count: 1 });
  return {
    name: names.join("+"),
    format: "commander",
    commanders: [card("Atraxa")],
    cards: names.map(card),
    sideboard: [],
  } as unknown as Deck;
}

async function load() {
  vi.resetModules();
  return import("@/lib/queueDecks");
}

describe("deck bracket cache", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    });
    fixture.findMyCombos.mockReset().mockResolvedValue({ included: [], almostIncluded: [] });
    fixture.unavailable = false;
  });

  it("stores brackets under the current version and reuses them next session", async () => {
    const first = await load();
    expect(await first.deckBracket(deck("Mana Crypt"))).toBe(3);
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    expect(stored.version).toBe(first.DECK_BRACKET_CACHE_VERSION);

    const second = await load();
    expect(second.cachedDeckBracket(deck("Mana Crypt"))).toBe(3);
    expect(second.hasFreshDeckBracket(deck("Mana Crypt"))).toBe(true);
    expect(await second.deckBracket(deck("Mana Crypt"))).toBe(3);
    expect(fixture.findMyCombos).toHaveBeenCalledTimes(1);
    expect(second.cachedDeckBracket(deck("Sol Ring"))).toBeUndefined();
  });

  it("ignores a cache written by another version", async () => {
    const { DECK_BRACKET_CACHE_VERSION } = await load();
    const { deckBracket } = await load();
    await deckBracket(deck("Mana Crypt"));
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...stored, version: DECK_BRACKET_CACHE_VERSION - 1 }),
    );

    const next = await load();
    expect(next.cachedDeckBracket(deck("Mana Crypt"))).toBeUndefined();
  });

  it("does not store fallback estimates", async () => {
    fixture.findMyCombos.mockRejectedValue(new Error("offline"));
    const first = await load();
    expect(await first.deckBracket(deck("Sol Ring"))).toBe(2);
    expect(localStorage.getItem(KEY)).toBeNull();

    fixture.findMyCombos.mockResolvedValue({ included: [], almostIncluded: [] });
    fixture.unavailable = true;
    await first.deckBracket(deck("Arcane Signet"));
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("rechecks stale entries but still shows them", async () => {
    const first = await load();
    await first.deckBracket(deck("Mana Crypt"));
    const stored = JSON.parse(localStorage.getItem(KEY)!);
    for (const entry of Object.values<{ checkedAt: number }>(stored.entries)) entry.checkedAt = 0;
    localStorage.setItem(KEY, JSON.stringify(stored));

    const second = await load();
    expect(second.cachedDeckBracket(deck("Mana Crypt"))).toBe(3);
    expect(second.hasFreshDeckBracket(deck("Mana Crypt"))).toBe(false);
    await second.deckBracket(deck("Mana Crypt"));
    expect(fixture.findMyCombos).toHaveBeenCalledTimes(2);
  });
});
