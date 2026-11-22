import { stripUsernameTag } from "@/lib/username";
import type { RoomInfo } from "@/types/server";

const PLAYER_STATUS = {
  Deciding: "Deciding",
  ChoosingDeck: "Choosing a deck",
  Ready: "Ready",
} as const;

export function postGameStatus(
  room: RoomInfo | null,
  username: string | null,
  playerOrder: string[],
  connected: boolean,
) {
  const playerStatuses: Record<string, string> = {};
  const rematchRequests: string[] = [];
  const rematch = room?.rematch;
  for (const [index, name] of playerOrder.entries()) {
    const seat = room?.players.find((player) => player.username === name);
    const choice = rematch?.players.find((player) => player.username === name);
    if (
      room?.status === "Finished" &&
      !rematch?.cancelled &&
      seat?.connected &&
      name !== username &&
      choice?.intent === "Ready"
    ) {
      rematchRequests.push(`player-${index}`);
    }
    playerStatuses[`player-${index}`] = !seat
      ? "Left"
      : !seat.connected
        ? "Disconnected"
        : seat.is_bot
          ? "Ready"
          : choice
            ? PLAYER_STATUS[choice.intent]
            : "Deciding";
  }
  if (!connected) {
    return {
      playerStatuses,
      rematchRequests: [],
      statusMessage: "Reconnecting to the table…",
      ready: false,
    };
  }
  if (!room) {
    return {
      playerStatuses,
      rematchRequests,
      statusMessage: "The table closed. Return Home to start a new game.",
      ready: false,
    };
  }
  const ready =
    rematch?.players.some((player) => player.username === username && player.intent === "Ready") ??
    false;
  if (rematch?.cancelled) {
    const left = rematch.players
      .filter((player) => !room.players.some((seat) => seat.username === player.username))
      .map((player) => stripUsernameTag(player.username));
    return {
      playerStatuses,
      rematchRequests,
      statusMessage: `${left.length ? `${new Intl.ListFormat("en").format(left)} left the table. ` : "The roster changed. "}Choose another deck to return to table setup and agree on the next game.`,
      ready: false,
    };
  }
  if (room.status !== "Finished" || !rematch) {
    return {
      playerStatuses,
      rematchRequests,
      statusMessage:
        room.status === "InGame"
          ? "Waiting for the host to finish the game…"
          : "Rematches are unavailable at this table. Update the host and server to play again.",
      ready: false,
    };
  }
  const others = rematch.players.filter((player) => player.username !== username);
  const waiting = others
    .filter((player) => {
      const seat = room.players.find((candidate) => candidate.username === player.username);
      return player.intent !== "Ready" || !seat?.connected;
    })
    .map((player) => player.username);
  for (const seat of room.players) {
    if (seat.is_bot && !seat.connected) waiting.push(seat.username);
  }
  const waitingNames = new Intl.ListFormat("en").format(waiting.map(stripUsernameTag));
  return {
    playerStatuses,
    rematchRequests,
    statusMessage: waitingNames
      ? `Waiting on ${waitingNames}`
      : ready
        ? "Everyone is ready. Waiting for the host to start the next game…"
        : "Everyone else is ready. Choose how you want to play again.",
    ready,
  };
}
