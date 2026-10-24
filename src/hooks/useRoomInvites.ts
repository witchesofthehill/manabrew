import { useEffect } from "react";
import { getPlatform } from "@/platform";
import { playAppSound } from "@/lib/soundRuntime";
import { useServerStore } from "@/stores/useServerStore";
import { useInviteStore } from "@/stores/useInviteStore";
import type { RoomInvitePayload } from "@/types/server";

export function useRoomInvites(): void {
  useEffect(() => {
    const platform = getPlatform();
    if (!platform.server) return;

    return platform.events.on<RoomInvitePayload>("server:room_invite", (invite) => {
      if (useServerStore.getState().gameStarted) return;
      const inviteStore = useInviteStore.getState();
      const isNew = !inviteStore.invites.some(
        (pending) => pending.room.room_id === invite.room.room_id,
      );
      inviteStore.add(invite);
      if (isNew) playAppSound("roomInvite");
    });
  }, []);
}
