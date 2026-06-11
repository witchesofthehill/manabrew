import type { PlayerDeckInfo, RoomInfo } from "@/types/server";

// Router state survives page reloads, but a game launch must not: the engine
// (and the room it belonged to) died with the page. Route state is therefore
// stamped with a per-page-load id and ignored when it was minted by an
// earlier page load — only the resume flow may start a game after a reload.
export const PAGE_LOAD_ID = crypto.randomUUID();

export interface EngineGameRouteState {
  multiplayer: true;
  bootId: string;
  playerOrder: string[];
  playerDecks: PlayerDeckInfo[];
  isHost: boolean;
  startingLife: number;
  myPlayerSlot: string;
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
  if (
    room &&
    !samePlayers(
      playerOrder,
      room.players.map((player) => player.username),
    )
  ) {
    return { error: "Server player order does not match the current room." };
  }
  const myIndex = playerOrder.indexOf(username ?? "");
  if (myIndex < 0) {
    return { error: "Could not determine your player slot for this game." };
  }
  return {
    state: {
      multiplayer: true,
      bootId: PAGE_LOAD_ID,
      playerOrder,
      playerDecks,
      isHost: room?.host === username,
      startingLife,
      myPlayerSlot: `player-${myIndex}`,
    },
  };
}
