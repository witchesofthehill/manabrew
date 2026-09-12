import { useEffect } from "react";
import { getPlatform } from "@/platform";
import { useServerStore } from "@/stores/useServerStore";
import { useInviteStore } from "@/stores/useInviteStore";
import type { RoomInvitePayload } from "@/types/server";

export function useRoomInvites(): void {
  useEffect(() => {
    const platform = getPlatform();
    if (!platform.server) return;

    return platform.events.on<RoomInvitePayload>("server:room_invite", (invite) => {
      if (useServerStore.getState().gameStarted) return;
      useInviteStore.getState().add(invite);
    });
  }, []);
}
