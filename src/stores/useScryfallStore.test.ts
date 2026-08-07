import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Deck, DeckCard } from "@/protocol/deck";
import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";

vi.mock("pixi.js", () => ({
  ImageSource: class {},
  Texture: class {
    static EMPTY = {};
  },
}));

const whiteSoldier = token("white", "Soldier", "ddo", "66", "W");
const redSoldier = token("red", "Soldier", "tths", "7", "R");

function token(
  id: string,
  name: string,
  setCode: string,
  cardNumber: string,
  color: string,
): DeckCard {
  return {
    identity: { id: `token:${id}`, name, setCode, cardNumber },
    uris: { small: "", normal: "", large: "", png: "", art_crop: "", border_crop: "" },
    color,
    colorIdentity: [color],
    manaCost: "",
    cmc: 0,
    types: ["Creature"],
    subtypes: ["Soldier"],
    supertypes: [],
    text: "",
  };
}

beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ schemaVersion: 2, tokens: [whiteSoldier, redSoldier] }),
    }),
  );
  const { prefetchTokenArchive } = await import("@/stores/useScryfallStore");
  await prefetchTokenArchive();
});

afterAll(() => vi.unstubAllGlobals());

describe("Forge token identities", () => {
  it("maps a parent set identity to the matching Scryfall token set", async () => {
    const { peekArchivedToken } = await import("@/stores/useScryfallStore");

    expect(peekArchivedToken({ setCode: "THS", cardNumber: "7" })?.identity.id).toBe("token:red");
    expect(peekArchivedToken({ setCode: "TTHS", cardNumber: "7" })?.identity.id).toBe("token:red");
  });

  it("prefers an exact archived token over an ambiguous deck token name", async () => {
    const { asDeckCard } = await import("@/lib/decks");
    const deck: Deck = { name: "test", cards: [], sideboard: [], tokens: [whiteSoldier] };
    const card = {
      ...GAME_CARD_DEFAULTS,
      identity: { name: "Soldier Token", setCode: "THS", cardNumber: "7", isToken: true },
      color: "R",
    };

    expect(asDeckCard(deck, card).identity.id).toBe("token:red");
  });
});
