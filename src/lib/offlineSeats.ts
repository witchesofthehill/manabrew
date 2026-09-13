/**
 * Who sat at an offline game, named the way the relay would name them. The
 * engine labels the human seat "You" on every client, so filing under that
 * folded every signed-out player into one row; the account handle or the guest
 * name the lobby connects with keeps them apart, and joins a player's offline
 * games to their relay games.
 */
import type { OfflineSeatOutcome } from "@/lib/offlinePlayRecord";
import { relayUsername } from "@/lib/relayUsername";
import type { ClientGameView } from "@/stores/gameStore.types";

export function offlineSeats(gameView: ClientGameView | null): OfflineSeatOutcome[] {
  const username = relayUsername();
  return (gameView?.players ?? []).map((player) => ({
    seatId: player.id,
    username: player.isHuman ? username || player.name : player.name,
    isBot: !player.isHuman,
    conceded: player.status === "conceded",
  }));
}
