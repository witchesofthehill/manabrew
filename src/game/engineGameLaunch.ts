import { MANABREW_ENGINE_UNAVAILABLE } from "@/types/server";
import type { EngineKind, GameFormat, PlayerDeckInfo, RoomInfo } from "@/types/server";

// Router state survives page reloads, but a game launch must not: the engine
// (and the room it belonged to) died with the page. Route state is therefore
// stamped with a per-page-load id and ignored when it was minted by an
// earlier page load — only the resume flow may start a game after a reload.
export const PAGE_LOAD_ID = crypto.randomUUID();

export interface EngineGameRouteState {
  multiplayer: true;
  spectator?: boolean;
  bootId: string;
  playerOrder: string[];
  playerDecks: PlayerDeckInfo[];
  isHost: boolean;
  startingLife: number;
  myPlayerSlot: string;
  engine: EngineKind;
  format: GameFormat;
  hostPlayerSlot: string | null;
  botPlayerSlots: string[];
}

export function isLiveEngineGameRouteState(state: unknown): state is EngineGameRouteState {
  return (
    typeof state === "object" &&
    state !== null &&
    "multiplayer" in state &&
    (state as EngineGameRouteState).bootId === PAGE_LOAD_ID
  );
}

function samePlayers(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((player) => rightSet.has(player));
}

export function buildEngineGameRouteState(
  username: string | null,
  room: RoomInfo | null,
  playerOrder: string[],
  playerDecks: PlayerDeckInfo[],
  startingLife: number,
): { state: EngineGameRouteState; error?: never } | { state?: never; error: string } {
  if (!room) return { error: "Could not find the room for this game." };
  if (room.engine === "Manabrew") {
    return { error: MANABREW_ENGINE_UNAVAILABLE };
  }
  const isSeated = room.players.some((player) => player.username === username);
  if (
    isSeated &&
    !samePlayers(
      playerOrder,
      room.players.map((player) => player.username),
    )
  ) {
    return { error: "Server player order does not match the current room." };
  }
  const myIndex = playerOrder.indexOf(username ?? "");
  const spectator = room.host !== username && !isSeated;
  if (!spectator && (myIndex < 0 || !isSeated)) {
    return { error: "Could not determine your player slot for this game." };
  }
  const hostIndex = playerOrder.indexOf(room.host);
  const botNames = new Set(room.players.filter((player) => player.is_bot).map((p) => p.username));
  const botPlayerSlots = playerOrder.flatMap((playerName, index) =>
    botNames.has(playerName) ? [`player-${index}`] : [],
  );
  return {
    state: {
      multiplayer: true,
      spectator,
      bootId: PAGE_LOAD_ID,
      playerOrder,
      playerDecks,
      isHost: room.host === username,
      startingLife,
      myPlayerSlot: spectator ? "spectator" : `player-${myIndex}`,
      engine: room.engine,
      format: room.format,
      hostPlayerSlot: hostIndex >= 0 ? `player-${hostIndex}` : null,
      botPlayerSlots,
    },
  };
}
