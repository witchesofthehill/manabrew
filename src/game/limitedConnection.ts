import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { useServerStore } from "@/stores/useServerStore";
import type { LimitedConnectionRecovery } from "@/game/limitedPersistence.types";
import type { ResumeRoomParams } from "@/platform/types";
import type { RoomInfo } from "@/types/server";

export function captureLimitedConnection(
  room: RoomInfo,
  sessionId: string,
  originalGameId?: string,
): LimitedConnectionRecovery {
  const server = useServerStore.getState();
  const prefs = usePreferencesStore.getState();
  const resume: ResumeRoomParams = {
    room_id: room.room_id,
    room_name: room.room_name,
    max_players: room.max_players,
    format: room.format,
    hosted: room.hosted,
    engine: "Manabrew",
    password: server.roomPassword ?? undefined,
    reconnect_timeout_s: room.reconnect_timeout_s,
    table_style: room.table_style,
    draft_config: room.draft_config,
    sealed_config: room.sealed_config,
    player_order: room.players.map((player) => player.username),
    player_decks: [],
    starting_life: server.startingLife,
    bot_players: room.players.filter((player) => player.is_bot).map((player) => player.username),
    game_id: originalGameId ?? (server.gameId || sessionId),
  };
  return {
    username: server.username ?? room.host,
    host: server.lanTarget?.host ?? prefs.serverHost,
    port: server.lanTarget?.port ?? prefs.serverPort,
    password: server.lanTarget?.password ?? prefs.serverPassword,
    roomPassword: server.roomPassword,
    room,
    resume,
  };
}
