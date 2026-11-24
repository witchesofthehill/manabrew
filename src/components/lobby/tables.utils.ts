import type { RoomInfo } from "@/types/server";

export function needsFormatChoice(room: RoomInfo) {
  return (
    room.format === "Any" &&
    !room.draft_config &&
    !room.sealed_config &&
    room.players.every((player) => player.is_bot)
  );
}

export function tableController(room: RoomInfo): string | undefined {
  return room.players.find((player) => !player.is_bot)?.username ?? room.players[0]?.username;
}

export function tableStartsAutomatically(room: RoomInfo): boolean {
  return (
    !room.draft_config &&
    !room.sealed_config &&
    !["Any", "Draft", "Sealed"].includes(room.format) &&
    (room.auto_start ?? !!room.matchmade_bracket)
  );
}

export function tableIsReady(room: RoomInfo): boolean {
  return (
    room.players.length === room.max_players &&
    room.players.length >= 2 &&
    room.players.every((player) => player.connected && player.ready && !!player.selected_deck_name)
  );
}
