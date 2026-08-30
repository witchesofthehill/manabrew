import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => vi.stubGlobal("__APP_VERSION__", "test"));

const recordEngineStats = vi.fn<(stats: unknown) => Promise<void>>();

vi.mock("@/api/hub", () => ({
  recordEngineStats: (stats: unknown) => recordEngineStats(stats),
  HubRequestError: class HubRequestError extends Error {
    status = 500;
  },
}));

vi.mock("@/platform", () => ({ getPlatform: () => ({ type: "web" }) }));

import { reportEngineStats } from "@/lib/engineStatsReport";
import { beginGame, noteAnswerSent, notePromptArrived } from "@/lib/engineTelemetry";

function playSixDecisions(engine: string) {
  beginGame(engine);
  for (let i = 0; i < 6; i += 1) {
    noteAnswerSent();
    notePromptArrived("chooseAction");
  }
}

describe("engine stats reporting", () => {
  beforeEach(() => {
    recordEngineStats.mockReset();
    recordEngineStats.mockResolvedValue(undefined);
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
      },
    });
  });

  it("keeps a report the relay could not take, and sends it to the hub", async () => {
    playSixDecisions("forge-hosted");
    reportEngineStats({
      multiplayer: true,
      seats: 2,
      format: "standard",
      endReason: "gameOver",
      gameId: "game-1",
      send: () => Promise.reject(new Error("relay is not connected")),
    });
    await vi.waitFor(() => expect(recordEngineStats).toHaveBeenCalledTimes(1));
    expect(recordEngineStats.mock.calls[0]?.[0]).toMatchObject({
      engine: "forge-hosted",
      multiplayer: true,
      endReason: "gameOver",
    });
  });

  it("reports a finished game once, however many times the game ends", () => {
    playSixDecisions("forge-hosted");
    const send = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const end = () =>
      reportEngineStats({
        multiplayer: true,
        seats: 2,
        format: "standard",
        endReason: "gameOver",
        gameId: "game-1",
        send,
      });
    end();
    end();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
