import { create } from "zustand";
import { toast } from "sonner";
import { useServerStore } from "@/stores/useServerStore";
import { USER_FACING_ERROR_MESSAGES } from "@/types/server";
import type { RoomInvitePayload, ServerErrorCode } from "@/types/server";

export const INVITE_TTL_MS = 30_000;

interface InviteState {
  /** Invites received, one per room. */
  invites: RoomInvitePayload[];
  /** Usernames this seat has invited to its current table. */
  sent: ReadonlySet<string>;
  add(invite: RoomInvitePayload): void;
  dismiss(roomId: string): void;
  accept(invite: RoomInvitePayload): Promise<boolean>;
  send(username: string): Promise<void>;
}

const expiry = new Map<string, ReturnType<typeof setTimeout>>();

export const useInviteStore = create<InviteState>()((set, get) => ({
  invites: [],
  sent: new Set(),

  add(invite) {
    const roomId = invite.room.room_id;
    clearTimeout(expiry.get(roomId));
    expiry.set(
      roomId,
      setTimeout(() => get().dismiss(roomId), INVITE_TTL_MS),
    );
    set({
      invites: [...get().invites.filter((i) => i.room.room_id !== roomId), invite],
    });
  },

  dismiss(roomId) {
    clearTimeout(expiry.get(roomId));
    expiry.delete(roomId);
    set({ invites: get().invites.filter((i) => i.room.room_id !== roomId) });
  },

  async accept(invite) {
    get().dismiss(invite.room.room_id);
    const server = useServerStore.getState();
    if (server.currentRoom?.room_id === invite.room.room_id) return true;
    try {
      if (server.currentRoom) await server.leaveRoom();
      await server.joinRoom(invite.room.room_id, invite.password);
      return true;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      toast.error(
        USER_FACING_ERROR_MESSAGES[code as ServerErrorCode] ?? "Couldn't join the table.",
      );
      return false;
    }
  },

  async send(username) {
    if (get().sent.has(username)) return;
    set({ sent: new Set(get().sent).add(username) });
    try {
      await useServerStore.getState().inviteToRoom(username);
    } catch (error) {
      const sent = new Set(get().sent);
      sent.delete(username);
      set({ sent });
      toast.error(error instanceof Error ? error.message : "Couldn't send the invite.");
    }
  },
}));

useServerStore.subscribe((state, prev) => {
  if (state.currentRoom?.room_id !== prev.currentRoom?.room_id) {
    useInviteStore.setState({ sent: new Set() });
  }
});
