import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { RoomInviteToast } from "@/components/lobby/RoomInviteToast";
import { getPlatform } from "@/platform";
import { useServerStore } from "@/stores/useServerStore";
import { ROUTES } from "@/lib/constants";
import { USER_FACING_ERROR_MESSAGES } from "@/types/server";
import type { RoomInvitePayload, ServerErrorCode } from "@/types/server";

const INVITE_TOAST_DURATION_MS = 30_000;

export function useRoomInvites(): void {
  const navigate = useNavigate();

  useEffect(() => {
    const platform = getPlatform();
    if (!platform.server) return;

    async function accept(invite: RoomInvitePayload) {
      const store = useServerStore.getState();
      if (store.currentRoom?.room_id === invite.room.room_id) {
        navigate(ROUTES.LOBBY);
        return;
      }
      try {
        if (store.currentRoom) await store.leaveRoom();
        await store.joinRoom(invite.room.room_id, invite.password);
        navigate(ROUTES.LOBBY);
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        toast.error(
          USER_FACING_ERROR_MESSAGES[code as ServerErrorCode] ?? "Couldn't join the table.",
        );
      }
    }

    return platform.events.on<RoomInvitePayload>("server:room_invite", (invite) => {
      const store = useServerStore.getState();
      if (store.gameStarted) return;
      const inviter = store.players.find((p) => p.username === invite.from);
      const id = `room-invite-${invite.room.room_id}`;
      toast.custom(
        () => (
          <RoomInviteToast
            from={invite.from}
            fromAvatarUrl={inviter?.avatar_url}
            room={invite.room}
            onJoin={() => {
              toast.dismiss(id);
              void accept(invite);
            }}
            onIgnore={() => toast.dismiss(id)}
          />
        ),
        { id, duration: INVITE_TOAST_DURATION_MS },
      );
    });
  }, [navigate]);
}
