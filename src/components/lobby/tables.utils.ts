import type { RoomInfo } from "@/types/server";

export function needsFormatChoice(room: RoomInfo) {
  return (
    room.format === "Any" &&
    !room.draft_config &&
    !room.sealed_config &&
    room.players.every((player) => player.is_bot)
  );
}
