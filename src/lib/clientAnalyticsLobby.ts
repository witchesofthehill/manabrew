import { trackClientEvent } from "@/lib/clientAnalytics";
import { analyticsDuration } from "@/lib/clientAnalyticsPrivacy";
import { useServerStore } from "@/stores/useServerStore";
import type { RoomInfo } from "@/types/server";

let lobbyWait: { roomId: string; startedAt: number } | undefined;

export function resetClientAnalyticsLobby() {
  lobbyWait = undefined;
}

export function observeClientAnalyticsLobby(room: RoomInfo | null, gameStarted: boolean) {
  if (!room) return;
  if (room.status === "InGame") {
    if (lobbyWait?.roomId === room.room_id) {
      trackClientEvent("lobby_wait", {
        outcome: "started",
        duration: analyticsDuration(performance.now() - lobbyWait.startedAt),
      });
    }
    lobbyWait = undefined;
    return;
  }
  if (gameStarted) return;
  if (lobbyWait?.roomId !== room.room_id) {
    lobbyWait = { roomId: room.room_id, startedAt: performance.now() };
  }
}

export function leaveRoomWithClientAnalytics(): Promise<void> {
  const server = useServerStore.getState();
  const room = server.currentRoom;
  const leaving = server.leaveRoom();
  if (
    room?.status === "Lobby" &&
    !server.gameStarted &&
    useServerStore.getState().currentRoom === null &&
    lobbyWait?.roomId === room.room_id
  ) {
    trackClientEvent("lobby_wait", {
      outcome: "left",
      duration: analyticsDuration(performance.now() - lobbyWait.startedAt),
    });
    lobbyWait = undefined;
  }
  return leaving;
}
