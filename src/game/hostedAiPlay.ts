import { getPlatform } from "@/platform";
import { getHostedAiServerConnectionDefaults } from "@/config/webRuntimeConfig";
import { createRoomRelayEnvelope, SELF_HOSTED_NODE_RELAY_PROTOCOL } from "@/game/roomRelay";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useServerStore } from "@/stores/useServerStore";
import type { GameFormat, GameStartedPayload, RoomInfo } from "@/types/server";
import type { RoomListPayload } from "@/types/server";
import type { Deck } from "@/types/manabrew";

const HOSTED_AI_TIMEOUT_MS = 20_000;

interface HostedAiGameRequest {
  playerDeck: Deck;
  opponentDeck: Deck;
  formatId: string;
  commanderName: string | null;
}

export interface HostedAiGameLaunch {
  playerOrder: string[];
  decks: Deck[];
  commanderNames: Array<string | null>;
  enginePlayerIndex: number;
  startingLife: number;
}

export async function startHostedAiGame(request: HostedAiGameRequest): Promise<HostedAiGameLaunch> {
  const platform = getPlatform();
  if (!platform.server) {
    throw new Error("Hosted AI play requires a multiplayer server.");
  }

  await ensureServerConnection();
  const username = useServerStore.getState().username;
  if (!username) throw new Error("Hosted AI play requires a server username.");

  const format = serverFormatFromId(request.formatId);
  const room = await findHostedRoom(format);
  await leaveCurrentRoomIfNeeded(room.room_id);
  await platform.server.joinRoom({ roomId: room.room_id });
  await waitForRoom((next) => next.room_id === room.room_id && hasPlayer(next, username));

  await platform.server.setDeckSelection({
    deckName: request.playerDeck.name || "Player Deck",
    deck: request.playerDeck,
    commanderName: request.commanderName,
  });
  await platform.server.setReady({ ready: true });

  await platform.server.sendRoomMessage(
    createRoomRelayEnvelope({
      protocol: SELF_HOSTED_NODE_RELAY_PROTOCOL,
      roomId: room.room_id,
      payload: {
        type: "spawnBot",
        deck: {
          deckName: request.opponentDeck.name || "AI Deck",
          deck: request.opponentDeck,
          commanderName: null,
        },
      },
    }),
  );

  await waitForRoom(
    (next) =>
      next.room_id === room.room_id &&
      next.players.length >= 2 &&
      next.players.every(
        (player) => player.connected && player.ready && !!player.selected_deck_name,
      ),
  );

  const gameStarted = waitForGameStarted(room.room_id);
  await platform.server.startGame({ format });

  const payload = await gameStarted;
  const enginePlayerIndex = payload.player_order.indexOf(username);
  if (enginePlayerIndex < 0) {
    throw new Error("Hosted game started without the local player.");
  }

  return {
    playerOrder: payload.player_order,
    decks: payload.player_order.map((playerName) => {
      const entry = payload.player_decks.find((deck) => deck.username === playerName);
      return entry?.deck ?? emptyDeck(playerName);
    }),
    commanderNames: payload.player_order.map((playerName) => {
      const entry = payload.player_decks.find((deck) => deck.username === playerName);
      return entry?.commander_name ?? null;
    }),
    enginePlayerIndex,
    startingLife: payload.starting_life,
  };
}

async function ensureServerConnection(): Promise<void> {
  const server = getPlatform().server;
  if (!server) throw new Error("Hosted AI play requires a multiplayer server.");

  const state = useServerStore.getState();
  if (state.connected) return;

  const prefs = usePreferencesStore.getState();
  const serverDefaults = getHostedAiServerConnectionDefaults();
  const username = prefs.serverUsername || serverDefaults.username || defaultHostedUsername();
  const auth = waitForEvent<{ success: boolean; error: string | null }>("server:auth_result");
  await server.connect({
    host: serverDefaults.host,
    port: serverDefaults.port,
    username,
    password: prefs.serverPassword || serverDefaults.password,
  });
  const result = await auth;
  if (!result.success) {
    throw new Error(result.error ?? "Server authentication failed.");
  }
  useServerStore.setState({
    connected: true,
    connecting: false,
    error: null,
    username,
  });
}

async function findHostedRoom(format: GameFormat): Promise<RoomInfo> {
  const rooms = await fetchRooms();
  const room = rooms.find(
    (candidate) =>
      candidate.hosted &&
      candidate.status === "Lobby" &&
      candidate.format === "Any" &&
      candidate.players.length < candidate.max_players,
  );
  if (!room) {
    throw new Error(`No self-hosted room is available for ${format}.`);
  }
  return room;
}

async function fetchRooms(): Promise<RoomInfo[]> {
  const server = getPlatform().server;
  if (!server) return [];
  const listed = waitForEvent<RoomListPayload>("server:room_list");
  await server.listRooms();
  return (await listed).rooms;
}

async function leaveCurrentRoomIfNeeded(targetRoomId: string): Promise<void> {
  const server = getPlatform().server;
  const currentRoom = useServerStore.getState().currentRoom;
  if (!server || !currentRoom || currentRoom.room_id === targetRoomId) return;
  await server.leaveRoom();
  useServerStore.setState({ currentRoom: null });
}

function waitForRoom(predicate: (room: RoomInfo) => boolean): Promise<RoomInfo> {
  return waitForEvent<{ room: RoomInfo }, RoomInfo>("server:room_update", (payload) =>
    predicate(payload.room) ? payload.room : null,
  );
}

function waitForGameStarted(roomId: string): Promise<GameStartedPayload> {
  return waitForEvent<GameStartedPayload>("server:game_started", (payload) =>
    payload.room_id === roomId ? payload : null,
  );
}

function waitForEvent<TPayload, TResult = TPayload>(
  event: string,
  select?: (payload: TPayload) => TResult | null,
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    const handle: { settled: boolean; timeout?: number; unsubscribe?: () => void } = {
      settled: false,
    };
    const cleanup = () => {
      handle.settled = true;
      if (handle.timeout !== undefined) window.clearTimeout(handle.timeout);
      handle.unsubscribe?.();
    };
    handle.unsubscribe = getPlatform().events.on<TPayload>(event, (payload) => {
      const selected = select ? select(payload) : (payload as unknown as TResult);
      if (selected === null) return;
      cleanup();
      resolve(selected);
    });
    // `on` may deliver a buffered event synchronously, settling before it
    // returns the unsubscribe handle — tear it down here and skip the timeout.
    if (handle.settled) {
      handle.unsubscribe();
      return;
    }
    handle.timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}.`));
    }, HOSTED_AI_TIMEOUT_MS);
  });
}

function hasPlayer(room: RoomInfo, username: string): boolean {
  return room.players.some((player) => player.username === username);
}

function serverFormatFromId(formatId: string): GameFormat {
  const normalized = formatId.toLowerCase();
  switch (normalized) {
    case "standard":
      return "Standard";
    case "pioneer":
      return "Pioneer";
    case "modern":
      return "Modern";
    case "legacy":
      return "Legacy";
    case "vintage":
      return "Vintage";
    case "pauper":
      return "Pauper";
    case "commander":
      return "Commander";
    case "brawl":
      return "Brawl";
    case "oathbreaker":
      return "Oathbreaker";
    case "draft":
      return "Draft";
    case "sealed":
      return "Sealed";
    default:
      return "Standard";
  }
}

function emptyDeck(name: string): Deck {
  return { name, cards: [], sideboard: [] };
}

function defaultHostedUsername(): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `web-player-${suffix}`;
}
