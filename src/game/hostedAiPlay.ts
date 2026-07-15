import { getPlatform } from "@/platform";
import { getHostedAiServerConnectionDefaults } from "@/config/webRuntimeConfig";
import type { ServerConnectionDefaults } from "@/config/webRuntimeConfig";
import { createRoomRelayEnvelope, SELF_HOSTED_NODE_RELAY_PROTOCOL } from "@/game/roomRelay";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useServerStore } from "@/stores/useServerStore";
import type { GameFormat, GameStartedPayload, RoomInfo } from "@/types/server";
import type { RoomListPayload } from "@/types/server";
import type {} from "@/protocol/game";
import type { Deck } from "@/protocol/deck";

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
  return joinHostedRoomAndPlay(room.room_id, format, request, username);
}

// The Tauri (graalvm) build has no pool of self-hosted rooms to discover: the
// desktop app hosts its own Forge room locally via `start_forge_host`
// (createRoom with engine "Forge"), then joins it and spawns the bot through
// the same relay handshake the web flow runs against a shared node. The relay
// itself is an in-process loopback server (`start_local_relay`) so no external
// relay is needed; if it can't start, the baked-in relay is used instead.
export async function startTauriForgeAiGame(
  request: HostedAiGameRequest,
): Promise<HostedAiGameLaunch> {
  const platform = getPlatform();
  if (!platform.server) {
    throw new Error("Forge play vs AI requires a multiplayer server.");
  }

  await ensureServerConnection(await startLocalRelay());
  const username = useServerStore.getState().username;
  if (!username) throw new Error("Forge play vs AI requires a server username.");

  const format = serverFormatFromId(request.formatId);
  const roomId = await platform.server.createRoom({
    roomName: `${username}'s Forge game`,
    maxPlayers: 2,
    format,
    engine: "Forge",
  });
  if (!roomId) throw new Error("Failed to start the local Forge host.");
  return joinHostedRoomAndPlay(roomId, format, request, username);
}

async function joinHostedRoomAndPlay(
  roomId: string,
  format: GameFormat,
  request: HostedAiGameRequest,
  username: string,
): Promise<HostedAiGameLaunch> {
  const platform = getPlatform();
  if (!platform.server) {
    throw new Error("Hosted AI play requires a multiplayer server.");
  }

  await leaveCurrentRoomIfNeeded(roomId);
  await platform.server.joinRoom({ roomId });
  await waitForRoom((next) => next.room_id === roomId && hasPlayer(next, username));

  await platform.server.setDeckSelection({
    deckName: request.playerDeck.name || "PlayerDto Deck",
    deck: request.playerDeck,
    commanderName: request.commanderName,
    avatar: usePreferencesStore.getState().customAvatar,
  });
  await platform.server.setReady({ ready: true });

  await platform.server.sendRoomMessage(
    createRoomRelayEnvelope({
      protocol: SELF_HOSTED_NODE_RELAY_PROTOCOL,
      roomId,
      payload: {
        type: "spawnBot",
        deck: {
          deckName: request.opponentDeck.name || "AI Deck",
          deck: request.opponentDeck,
          commanderName: request.opponentDeck.commanders?.[0]?.identity.name ?? null,
        },
      },
    }),
  );

  await waitForRoom(
    (next) =>
      next.room_id === roomId &&
      next.players.length >= 2 &&
      next.players.every(
        (player) => player.connected && player.ready && !!player.selected_deck_name,
      ),
  );

  const gameStarted = waitForGameStarted(roomId);
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

async function startLocalRelay(): Promise<ServerConnectionDefaults | null> {
  const platform = getPlatform();
  if (useServerStore.getState().connected) return null;
  try {
    const relay = await platform.invoke<{ host: string; port: number; password: string }>(
      "start_local_relay",
    );
    return { host: relay.host, port: relay.port, username: "", password: relay.password };
  } catch (error) {
    console.warn("[hostedAiPlay] local relay unavailable; using the external relay:", error);
    return null;
  }
}

async function ensureServerConnection(localRelay?: ServerConnectionDefaults | null): Promise<void> {
  const server = getPlatform().server;
  if (!server) throw new Error("Hosted AI play requires a multiplayer server.");

  const state = useServerStore.getState();
  if (state.connected) return;

  const prefs = usePreferencesStore.getState();
  const serverDefaults = localRelay ?? getHostedAiServerConnectionDefaults();
  const username = prefs.serverUsername || serverDefaults.username || defaultHostedUsername();
  const auth = waitForEvent<{ success: boolean; error: string | null }>("server:auth_result");
  await server.connect({
    host: serverDefaults.host,
    port: serverDefaults.port,
    username,
    password: localRelay ? localRelay.password : prefs.serverPassword || serverDefaults.password,
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
