import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => vi.stubGlobal("__APP_VERSION__", "test"));

const recordOfflineGame = vi.fn<(game: unknown) => Promise<void>>();

vi.mock("@/api/hub", () => ({
  recordOfflineGame: (game: unknown) => recordOfflineGame(game),
  HubRequestError: class HubRequestError extends Error {
    status = 500;
  },
}));

vi.mock("@/platform", () => ({ getPlatform: () => ({ type: "web" }) }));
vi.mock("@/lib/deckFingerprint", () => ({
  getDeckEvidenceFingerprint: () => Promise.resolve("fingerprint"),
}));

import {
  abandonOfflineGame,
  beginOfflineGame,
  currentOfflineGameId,
  reportOfflineGame,
} from "@/lib/offlinePlayRecord";
import type { Deck } from "@/protocol";

const deck = {
  name: "Mono Red",
  cards: [],
  commanders: [],
  sideboard: [],
} as unknown as Deck;

async function launch() {
  await beginOfflineGame({
    engine: "forge-wasm",
    format: "commander",
    startingLife: 40,
    decks: { p1: deck, p2: deck },
  });
}

const seats = [
  { seatId: "p1", username: "player", isBot: false, conceded: false },
  { seatId: "p2", username: "AI", isBot: true, conceded: false },
];

describe("offline play records", () => {
  beforeEach(() => {
    recordOfflineGame.mockReset();
    recordOfflineGame.mockResolvedValue(undefined);
    abandonOfflineGame();
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    });
  });

  it("files the game under the id it minted at launch", async () => {
    await launch();
    // Read while the game is open, which is the only moment the engine report
    // beside it can ask: reporting drains the record.
    const id = currentOfflineGameId();
    expect(id).toBeTruthy();

    reportOfflineGame({ gameOver: true, winner: "player", seats });
    await vi.waitFor(() => expect(recordOfflineGame).toHaveBeenCalledTimes(1));
    expect(recordOfflineGame.mock.calls[0]?.[0]).toMatchObject({ reportId: id });
    expect(currentOfflineGameId()).toBeNull();
  });

  it("gives each game its own id", async () => {
    await launch();
    const first = currentOfflineGameId();
    reportOfflineGame({ gameOver: true, winner: "player", seats });

    await launch();
    expect(currentOfflineGameId()).not.toBe(first);
  });

  it("reports a game once, however many times it ends", async () => {
    await launch();
    reportOfflineGame({ gameOver: true, winner: "player", seats });
    reportOfflineGame({ gameOver: true, winner: "player", seats });
    await vi.waitFor(() => expect(recordOfflineGame).toHaveBeenCalledTimes(1));
  });
});
