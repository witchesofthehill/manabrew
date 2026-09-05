import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { toast } from "sonner";
import { getPlatform } from "@/platform";
import { useServerStore } from "@/stores/useServerStore";
import { CHAT_ERROR_CODES, RELAY_FEATURE, USER_FACING_ERROR_MESSAGES } from "@/types/server";
import type {
  ChatHistoryPayload,
  ChatMessagePayload,
  ChatScope,
  DisconnectedPayload,
  ServerErrorCode,
  ServerErrorPayload,
} from "@/types/server";

export interface ChatEntry {
  id: number;
  from: string;
  avatarUrl?: string;
  qualification?: string;
  text: string;
  sentAtMs: number;
  system?: boolean;
  seal?: string;
}

const MAX_ENTRIES_PER_SCOPE = 200;

interface ChatState {
  lobby: ChatEntry[];
  room: ChatEntry[];
  roomId: string | null;
  unread: Record<ChatScope, number>;
  lastSentScope: ChatScope;

  send(scope: ChatScope, text: string): Promise<void>;
  markRead(scope: ChatScope): void;
  setupListeners(): () => void;
}

let nextEntryId = 1;

function toEntry(payload: ChatMessagePayload): ChatEntry {
  return {
    id: nextEntryId++,
    from: payload.from,
    avatarUrl: payload.avatar_url,
    qualification: payload.qualification,
    text: payload.text,
    sentAtMs: payload.sent_at_ms,
    seal: payload.seal,
  };
}

function append(entries: ChatEntry[], entry: ChatEntry): ChatEntry[] {
  const next = [...entries, entry];
  return next.length > MAX_ENTRIES_PER_SCOPE ? next.slice(-MAX_ENTRIES_PER_SCOPE) : next;
}

export const useChatStore = create<ChatState>()(
  devtools(
    (set, get) => ({
      lobby: [],
      room: [],
      roomId: null,
      unread: { Lobby: 0, Room: 0 },
      lastSentScope: "Lobby",

      async send(scope, text) {
        const trimmed = text.trim();
        if (!trimmed) return;
        const server = getPlatform().server;
        if (!server) return;
        if (!useServerStore.getState().hasRelayFeature(RELAY_FEATURE.Chat)) {
          toast.error("This relay doesn't support chat");
          return;
        }
        set({ lastSentScope: scope });
        await server.sendChat({ scope, text: trimmed });
      },

      markRead(scope) {
        if (get().unread[scope] === 0) return;
        set({ unread: { ...get().unread, [scope]: 0 } });
      },

      setupListeners() {
        const platform = getPlatform();
        if (!platform.server) return () => {};

        const unsubscribers: (() => void)[] = [];

        unsubscribers.push(
          platform.events.on<ChatHistoryPayload>("server:chat_history", (payload) => {
            const entries = payload.messages.map(toEntry);
            if (payload.scope === "Lobby") {
              set({ lobby: entries });
              return;
            }
            if (payload.room_id !== get().roomId) return;
            set({ room: entries });
          }),
        );

        unsubscribers.push(
          platform.events.on<ChatMessagePayload>("server:chat_message", (payload) => {
            const entry = toEntry(payload);
            const mine = payload.from === useServerStore.getState().username;
            const { unread } = get();
            if (payload.scope === "Lobby") {
              set({
                lobby: append(get().lobby, entry),
                unread: mine ? unread : { ...unread, Lobby: unread.Lobby + 1 },
              });
              return;
            }
            if (payload.room_id !== get().roomId) return;
            set({
              room: append(get().room, entry),
              unread: mine ? unread : { ...unread, Room: unread.Room + 1 },
            });
          }),
        );

        unsubscribers.push(
          platform.events.on<ServerErrorPayload>("server:error", (payload) => {
            const code = payload.code as ServerErrorCode;
            if (!CHAT_ERROR_CODES.has(code)) return;
            const entry: ChatEntry = {
              id: nextEntryId++,
              from: "",
              text: USER_FACING_ERROR_MESSAGES[code] ?? payload.message,
              sentAtMs: Date.now(),
              system: true,
            };
            if (get().lastSentScope === "Lobby") set({ lobby: append(get().lobby, entry) });
            else set({ room: append(get().room, entry) });
          }),
        );

        unsubscribers.push(
          useServerStore.subscribe((state, prev) => {
            const roomId = state.currentRoom?.room_id ?? null;
            if (roomId === (prev.currentRoom?.room_id ?? null)) return;
            set({ roomId, room: [], unread: { ...get().unread, Room: 0 } });
          }),
        );

        unsubscribers.push(
          platform.events.on<DisconnectedPayload>("server:disconnected", (payload) => {
            if (!payload?.terminal) return;
            set({ lobby: [], room: [], roomId: null, unread: { Lobby: 0, Room: 0 } });
          }),
        );

        return () => unsubscribers.forEach((fn) => fn());
      },
    }),
    { name: "chat", enabled: import.meta.env.DEV },
  ),
);
