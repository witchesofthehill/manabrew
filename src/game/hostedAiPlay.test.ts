// @vitest-environment jsdom

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deck } from "@/protocol/deck";

vi.hoisted(() => vi.stubGlobal("__APP_VERSION__", "test"));
vi.mock("pixi.js", () => ({
  ImageSource: class {},
  Texture: class {
    static EMPTY = {};
  },
}));

const LOOPBACK = "127.0.0.1";
const PROD = "relay.example";

// One socket, like the web relay client the Tauri platform wraps: whichever
// connect lands last owns it.
const relay = vi.hoisted(() => ({
  socketHost: null as string | null,
  connects: [] as string[],
  roomCreatedOn: null as string | null,
  roomJoinedOn: null as string | null,
  listeners: new Map<string, Set<(payload: unknown) => void>>(),
}));

function emit(event: string, payload: unknown) {
  for (const listener of relay.listeners.get(event) ?? []) listener(payload);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

vi.mock("@/platform", () => {
  const server = {
    connect: vi.fn(async ({ host }: { host: string }) => {
      await tick();
      relay.socketHost = host;
      relay.connects.push(host);
      setTimeout(() => emit("server:auth_result", { success: true, error: null }), 0);
    }),
    disconnect: vi.fn(async () => {
      relay.socketHost = null;
    }),
    createRoom: vi.fn(async () => {
      relay.roomCreatedOn = relay.socketHost;
      return "local-room";
    }),
    joinRoom: vi.fn(async () => {
      relay.roomJoinedOn = relay.socketHost;
      // End the launch here: the join never confirms, the store times out.
      throw new Error("stop after join");
    }),
    leaveRoom: vi.fn(async () => {}),
    stopRoom: vi.fn(async () => {}),
    listRooms: vi.fn(async () => {}),
    listPlayers: vi.fn(async () => {}),
  };
  const platform = {
    type: "tauri",
    server,
    invoke: vi.fn(async (command: string) => {
      await tick();
      if (command === "start_local_relay") return { host: LOOPBACK, port: 7777, password: "" };
      return undefined;
    }),
    events: {
      on: (event: string, listener: (payload: unknown) => void) => {
        const set = relay.listeners.get(event) ?? new Set();
        set.add(listener);
        relay.listeners.set(event, set);
        return () => set.delete(listener);
      },
    },
  };
  return { getPlatform: () => platform, getPlatformType: () => "tauri" };
});

vi.mock("@/lib/lanRelay", () => ({
  findLanRelay: vi.fn(async () => {
    await tick();
    return null;
  }),
}));

vi.mock("@/lib/tabSession", () => ({
  claimTabSession: vi.fn(async () => ({ outcome: "claimed" })),
  holdTabSession: vi.fn(() => ({ release: () => {} })),
  probeTabSession: vi.fn(async () => "free"),
}));

vi.mock("@/lib/relayUsername", () => ({ relayUsername: () => "Cheeto666" }));

vi.mock("@/game/limitedStorage", () => ({
  LIMITED_STORE_NAMES: {},
  subscribeLimitedSaves: () => () => {},
  readLimitedSave: async () => null,
  listLimitedSaves: async () => [],
  updateLimitedSave: async () => {},
  flushLimitedStorage: async () => {},
  limitedStateStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
}));

let startTauriForgeAiGame: typeof import("./hostedAiPlay").startTauriForgeAiGame;
let useServerStore: typeof import("@/stores/useServerStore").useServerStore;
let usePreferencesStore: typeof import("@/stores/usePreferencesStore").usePreferencesStore;

beforeAll(async () => {
  ({ startTauriForgeAiGame } = await import("./hostedAiPlay"));
  ({ useServerStore } = await import("@/stores/useServerStore"));
  ({ usePreferencesStore } = await import("@/stores/usePreferencesStore"));
});

afterAll(() => vi.unstubAllGlobals());

beforeEach(() => {
  relay.socketHost = PROD;
  relay.connects = [];
  relay.roomCreatedOn = null;
  relay.roomJoinedOn = null;
  usePreferencesStore.setState({ serverHost: PROD, serverPort: 443, serverPassword: "" });
  useServerStore.setState({
    connected: true,
    connecting: false,
    error: null,
    username: "Cheeto666",
    currentRoom: null,
  });
});

const deck = { name: "Helga", cards: [], sideboard: [] } as unknown as Deck;

describe("desktop all-AI lobby table handoff (#1218)", () => {
  it("keeps the lobby's auto-connect off the shared relay while it moves to the loopback relay", async () => {
    // What Lobby.tsx does while it stays mounted during the handoff.
    const unsubscribe = useServerStore.subscribe((state) => {
      if (state.connected || state.connecting || state.error) return;
      void state.connectPreferred("Cheeto666");
    });
    try {
      await startTauriForgeAiGame({
        playerDeck: deck,
        opponentDecks: [deck, deck, deck],
        formatId: "commander",
        commanderName: "Helga, Skittish Seer",
      }).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      unsubscribe();
    }

    expect(relay.roomCreatedOn).toBe(LOOPBACK);
    expect(relay.roomJoinedOn).toBe(LOOPBACK);
    const handoff = relay.connects.slice(0, relay.connects.indexOf(LOOPBACK) + 1);
    expect(handoff).toEqual([LOOPBACK]);
  });
});
