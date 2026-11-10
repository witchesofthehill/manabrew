import { peekSpawnedBots } from "@/lib/spawnedBots";
import { getPlatformType } from "@/platform";
import type { Deck } from "@/protocol/deck";
import { isTauriForgeRoomAvailable } from "@/stores/useForgeRoomAvailabilityStore";
import type { RoomInfo } from "@/types/server";

export interface LocalAiTableLaunch {
  playerDeck: Deck;
  commanderName?: string;
  opponentDecks: Deck[];
  formatId: string;
}

/** A desktop-hosted Forge table whose other seats are all this player's bots runs on the loopback relay. */
export function localAiTableLaunch(
  room: RoomInfo,
  username: string | null,
  hostingForgeRoom: boolean,
  selection: { deck: Deck; commanderName?: string } | null,
): LocalAiTableLaunch | null {
  if (getPlatformType() !== "tauri" || !isTauriForgeRoomAvailable()) return null;
  if (!hostingForgeRoom || room.engine !== "Forge" || !selection || !username) return null;
  if (room.draft_config || room.sealed_config) return null;
  const others = room.players.filter((player) => player.username !== username);
  if (others.length === 0 || others.length === room.players.length) return null;
  const bots = new Map(peekSpawnedBots(room.room_id).map((bot) => [bot.username, bot]));
  const opponentDecks: Deck[] = [];
  for (const player of others) {
    const bot = bots.get(player.username);
    if (!player.is_bot || !bot) return null;
    opponentDecks.push(bot.deck);
  }
  return {
    playerDeck: selection.deck,
    commanderName: selection.commanderName,
    opponentDecks,
    formatId: room.format.toLowerCase(),
  };
}
