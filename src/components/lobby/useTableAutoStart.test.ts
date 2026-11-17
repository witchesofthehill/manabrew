// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomInfo } from "@/types/server";

const fixture = vi.hoisted(() => ({
  send: vi.fn(),
  presets: [
    {
      name: "Elves",
      format: "commander",
      cards: [],
      sideboard: [],
      commanders: [{ identity: { name: "Lathril" } }],
    },
  ],
}));
vi.mock("@/platform", () => ({
  getPlatform: () => ({ server: { sendRoomMessage: fixture.send } }),
}));
vi.mock("@/stores/usePresetDecksStore", () => ({ usePresetDecks: () => fixture.presets }));
import { useTableAutoStart } from "./useTableAutoStart";

const start = vi.fn(async () => {});
const spawnBot = vi.fn(async () => {});
let root: Root;
function Probe({ room, username = "Alex" }: { room: RoomInfo; username?: string }) {
  useTableAutoStart({ room, username, start, spawnBot });
  return null;
}
function table(overrides: Partial<RoomInfo> = {}): RoomInfo {
  return {
    room_id: "table",
    room_name: "Table",
    host: "Alex",
    format: "Commander",
    status: "Lobby",
    engine: "Forge",
    max_players: 2,
    auto_start: true,
    hosted: false,
    password_protected: false,
    players: ["Alex", "Sam"].map((username) => ({
      username,
      ready: true,
      connected: true,
      selected_deck_name: "Elves",
    })),
    ...overrides,
  } as RoomInfo;
}
async function render(room: RoomInfo, username?: string) {
  await act(async () => root.render(createElement(Probe, { room, username })));
}
beforeEach(() => {
  vi.clearAllMocks();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

describe("automatic table startup", () => {
  it("starts a full ready table once", async () => {
    await render(table());
    await render(table());
    expect(start).toHaveBeenCalledTimes(1);
  });
  it("waits for an empty seat to fill", async () => {
    await render(table({ max_players: 4 }));
    expect(start).not.toHaveBeenCalled();
  });
  it.each(["disconnected", "unready", "no deck"])(
    "waits when a player is %s",
    async (condition) => {
      const room = table();
      if (condition === "disconnected") room.players[1].connected = false;
      if (condition === "unready") room.players[1].ready = false;
      if (condition === "no deck") room.players[1].selected_deck_name = undefined;
      await render(room);
      expect(start).not.toHaveBeenCalled();
      await render(table());
      expect(start).toHaveBeenCalledTimes(1);
    },
  );
  it("leaves manual startup to the host", async () => {
    await render(table({ auto_start: false }));
    expect(start).not.toHaveBeenCalled();
  });
  it("lets only the first human drive a node room", async () => {
    const room = table({ hosted: true, host: "Node" });
    await render(room, "Sam");
    expect(start).not.toHaveBeenCalled();
    await render(room, "Alex");
    expect(start).toHaveBeenCalledTimes(1);
  });
  it.each(["Any", "Draft", "Sealed"] as const)("does not auto-start %s", async (format) => {
    await render(table({ format }));
    expect(start).not.toHaveBeenCalled();
  });
  it("spawns opted-in browser bots once and waits for them", async () => {
    await render(table({ max_players: 4, matchmade_bot_fill: true }));
    await render(table({ max_players: 4, matchmade_bot_fill: true }));
    expect(spawnBot).toHaveBeenCalledTimes(2);
    expect(start).not.toHaveBeenCalled();
  });
  it("sends bot fill to the node instead of spawning browser bots", async () => {
    await render(table({ hosted: true, host: "Node", max_players: 4, matchmade_bot_fill: true }));
    expect(fixture.send).toHaveBeenCalledTimes(1);
    expect(spawnBot).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });
  it("never fills a public table with bots without opt-in", async () => {
    await render(table({ max_players: 4 }));
    expect(spawnBot).not.toHaveBeenCalled();
    expect(fixture.send).not.toHaveBeenCalled();
  });
});
