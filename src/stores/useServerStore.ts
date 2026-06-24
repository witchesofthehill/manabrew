import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { toast } from "sonner";
import { getPlatform } from "@/platform";
import { attachDraftPeer, detachDraftPeer } from "@/game/draftPeer";
import { teardownHost as teardownDraftHost } from "@/game/draftHost";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { SERVER_ERROR_CODE, USER_FACING_ERROR_MESSAGES } from "@/types/server";
import type {
  RoomInfo,
  PlayerInfo,
  GameFormat,
  EngineKind,
  DraftConfig,
  SealedConfig,
  PlayerDeckInfo,
  AuthResultPayload,
  RoomListPayload,
  PlayerListPayload,
  RoomUpdatePayload,
  RoomCreatedPayload,
  PlayerJoinedPayload,
  PlayerLeftPayload,
  PlayerConnectionPayload,
  ReadyChangedPayload,
  GameStartedPayload,
  ServerErrorCode,
  ServerErrorPayload,
  ReconnectingPayload,
  DisconnectedPayload,
} from "@/types/server";
import type { Deck } from "@/protocol/deck";

export const DEFAULT_STARTING_LIFE = 20;

export interface ReconnectState {
  phase: "idle" | "reconnecting" | "failed";
  attempt: number;
  reason?: "network" | "server-shutdown";
}

interface ServerState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  playerId: string | null;
  username: string | null;
  reconnect: ReconnectState;

  rooms: RoomInfo[];
  currentRoom: RoomInfo | null;
  roomPassword: string | null;
  players: PlayerInfo[];

  gameStarted: boolean;
  playerOrder: string[];
  playerDecks: PlayerDeckInfo[];
  startingLife: number;

  connect(host: string, port: number, username: string, password: string): Promise<void>;
  disconnect(): Promise<void>;
  listRooms(): Promise<void>;
  listPlayers(): Promise<void>;
  createRoom(
    roomName: string,
    maxPlayers: number,
    format: GameFormat,
    engine?: EngineKind,
    draftConfig?: DraftConfig,
    sealedConfig?: SealedConfig,
    reconnectTimeoutS?: number,
    password?: string,
  ): Promise<void>;
  joinRoom(roomId: string, password?: string): Promise<void>;
  leaveRoom(): Promise<void>;
  setReady(ready: boolean): Promise<void>;
  setDeckSelection(deckName: string, deck: Deck, commanderName?: string): Promise<void>;
  setFormat(format: GameFormat): Promise<void>;
  setMaxPlayers(maxPlayers: number): Promise<void>;
  startGame(format?: GameFormat): Promise<void>;
  endGame(): Promise<void>;

  setupListeners(): () => void;
}

export const JOIN_REJECTED_INCORRECT_PASSWORD = SERVER_ERROR_CODE.IncorrectPassword;

const JOIN_CONFIRM_TIMEOUT_MS = 7000;

interface PendingJoin {
  roomId: string;
  settle: (error: Error | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

let pendingJoin: PendingJoin | null = null;

function settlePendingJoin(error: Error | null, roomId?: string) {
  if (!pendingJoin) return;
  if (roomId && pendingJoin.roomId !== roomId) return;
  clearTimeout(pendingJoin.timer);
  const { settle } = pendingJoin;
  pendingJoin = null;
  settle(error);
}

export const useServerStore = create<ServerState>()(
  devtools(
    (set, get) => ({
      connected: false,
      connecting: false,
      error: null,
      playerId: null,
      username: null,
      reconnect: { phase: "idle", attempt: 0 },
      rooms: [],
      currentRoom: null,
      roomPassword: null,
      players: [],
      gameStarted: false,
      playerOrder: [],
      playerDecks: [],
      startingLife: DEFAULT_STARTING_LIFE,

      async connect(host, port, username, password) {
        const platform = getPlatform();
        if (!platform.server) {
          set({ connecting: false, error: "Multiplayer not supported on this platform" });
          return;
        }
        set({ username, connecting: true, error: null });
        try {
          await platform.server.connect({ host, port, username, password });
        } catch (e) {
          set({ connecting: false, error: String(e) });
        }
      },

      async disconnect() {
        const platform = getPlatform();
        if (!platform.server) return;
        await platform.server.disconnect();
        set({
          connected: false,
          playerId: null,
          username: null,
          currentRoom: null,
          gameStarted: false,
          playerOrder: [],
          playerDecks: [],
          startingLife: DEFAULT_STARTING_LIFE,
          rooms: [],
          players: [],
        });
      },

      async listRooms() {
        const platform = getPlatform();
        if (!platform.server) return;
        await platform.server.listRooms();
      },

      async listPlayers() {
        const platform = getPlatform();
        if (!platform.server) return;
        await platform.server.listPlayers();
      },

      async createRoom(
        roomName,
        maxPlayers,
        format,
        engine,
        draftConfig,
        sealedConfig,
        reconnectTimeoutS,
        password,
      ) {
        const platform = getPlatform();
        if (!platform.server) return;
        set({ roomPassword: password ? password : null });
        const roomId = await platform.server.createRoom({
          roomName,
          maxPlayers,
          format,
          engine,
          draftConfig,
          sealedConfig,
          reconnectTimeoutS,
          password,
        });
        if (roomId) {
          await get().joinRoom(roomId, password);
        }
      },

      async joinRoom(roomId, password) {
        const platform = getPlatform();
        if (!platform.server) return;
        settlePendingJoin(new Error("join_superseded"));
        set({ roomPassword: password ? password : null });
        await platform.server.joinRoom({ roomId, password });
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingJoin = null;
            reject(new Error("join_timeout"));
          }, JOIN_CONFIRM_TIMEOUT_MS);
          pendingJoin = {
            roomId,
            timer,
            settle: (error) => (error ? reject(error) : resolve()),
          };
        });
      },

      async leaveRoom() {
        // Reset local room state synchronously so a hung relay socket can't
        // strand the user in a "still-in-room" UI. The server-side teardown
        // is attempted afterwards as best-effort; if it fails, the next
        // listRooms() call will reconcile.
        // The peer relay listener stays attached — it is connection-scoped
        // (attached once at auth), not room-scoped.
        teardownDraftHost();
        useMultiplayerDraftStore.getState().clear();
        set({
          currentRoom: null,
          roomPassword: null,
          gameStarted: false,
          playerOrder: [],
          playerDecks: [],
          startingLife: DEFAULT_STARTING_LIFE,
        });
        const platform = getPlatform();
        if (!platform.server) return;
        try {
          await platform.server.leaveRoom();
        } catch (e) {
          console.warn("server.leaveRoom() failed:", e);
        }
        try {
          await platform.server.stopRoom();
        } catch (e) {
          console.warn("server.stopForgeRoom() failed:", e);
        }
        try {
          await get().listRooms();
        } catch (e) {
          console.warn("listRooms() after leaveRoom failed:", e);
        }
      },

      async setReady(ready) {
        const platform = getPlatform();
        if (!platform.server) return;
        await platform.server.setReady({ ready });
      },

      async setDeckSelection(deckName, deck, commanderName) {
        const platform = getPlatform();
        if (!platform.server) return;
        const prefs = usePreferencesStore.getState();
        const deckHasPlaymat = !!deck.playmat || !!deck.playmatSettings?.color;
        await platform.server.setDeckSelection({
          deckName,
          deck: deckHasPlaymat
            ? deck
            : {
                ...deck,
                playmat: prefs.defaultPlaymat,
                playmatSettings: prefs.defaultPlaymatSettings,
              },
          commanderName: commanderName ?? null,
          avatar: prefs.customAvatar,
        });
      },

      async setFormat(format) {
        const platform = getPlatform();
        if (!platform.server) return;
        await platform.server.setFormat({ format });
      },

      async setMaxPlayers(maxPlayers) {
        const platform = getPlatform();
        if (!platform.server) return;
        await platform.server.setMaxPlayers({ maxPlayers });
      },

      async startGame(format) {
        const platform = getPlatform();
        if (!platform.server) return;
        await platform.server.startGame(format ? { format } : undefined);
      },

      async endGame() {
        const platform = getPlatform();
        if (!platform.server) return;
        await platform.server.endGame();
      },

      setupListeners() {
        // Server functionality requires a server API
        const platform = getPlatform();
        if (!platform.server) {
          return () => {}; // No-op cleanup for platforms without server support
        }

        const unsubscribers: (() => void)[] = [];

        unsubscribers.push(
          platform.events.on<AuthResultPayload>("server:auth_result", (payload) => {
            if (payload.success) {
              set({
                connected: true,
                connecting: false,
                error: null,
                playerId: payload.player_id,
                reconnect: { phase: "idle", attempt: 0 },
              });
              get().listRooms();
              get().listPlayers();
              const username = get().username;
              if (username) {
                attachDraftPeer(username);
              }
            } else {
              set({ connecting: false, error: payload.error ?? "Authentication failed" });
            }
          }),
        );

        unsubscribers.push(
          platform.events.on<ReconnectingPayload>("server:reconnecting", (payload) => {
            set({
              reconnect: {
                phase: payload.phase,
                attempt: payload.attempt,
                reason: payload.reason,
              },
              connected: payload.phase === "idle" ? get().connected : false,
            });
          }),
        );

        unsubscribers.push(
          platform.events.on<RoomListPayload>("server:room_list", (payload) => {
            set({ rooms: payload.rooms });
          }),
        );

        unsubscribers.push(
          platform.events.on<PlayerListPayload>("server:player_list", (payload) => {
            set({ players: payload.players });
          }),
        );

        unsubscribers.push(
          platform.events.on<RoomCreatedPayload>("server:room_created", () => {
            get().listRooms();
          }),
        );

        unsubscribers.push(
          platform.events.on<RoomUpdatePayload>("server:room_update", (payload) => {
            set({ currentRoom: payload.room });
            settlePendingJoin(null, payload.room.room_id);
          }),
        );

        unsubscribers.push(
          platform.events.on<PlayerJoinedPayload>("server:player_joined", () => {
            get().listRooms();
            get().listPlayers();
          }),
        );

        unsubscribers.push(
          platform.events.on<PlayerLeftPayload>("server:player_left", () => {
            get().listRooms();
            get().listPlayers();
          }),
        );

        unsubscribers.push(
          platform.events.on<PlayerConnectionPayload>("server:player_connected", () => {
            get().listPlayers();
          }),
        );

        unsubscribers.push(
          platform.events.on<PlayerConnectionPayload>("server:player_disconnected", () => {
            get().listPlayers();
          }),
        );

        unsubscribers.push(
          platform.events.on<ReadyChangedPayload>("server:ready_changed", () => {
            // Room update will come separately with full state
          }),
        );

        unsubscribers.push(
          platform.events.on<GameStartedPayload>("server:game_started", (payload) => {
            set({
              gameStarted: true,
              playerOrder: payload.player_order,
              playerDecks: payload.player_decks,
              startingLife: payload.starting_life,
            });
          }),
        );

        unsubscribers.push(
          platform.events.on<ServerErrorPayload>("server:error", (payload) => {
            console.error("[server] error:", payload.code, payload.message);
            if (payload.code === SERVER_ERROR_CODE.GameNotInProgress) return;
            if (payload.code === SERVER_ERROR_CODE.IncorrectPassword) {
              settlePendingJoin(new Error(SERVER_ERROR_CODE.IncorrectPassword));
              return;
            }
            if (payload.code === SERVER_ERROR_CODE.NotInRoom) {
              set({
                currentRoom: null,
                gameStarted: false,
                playerOrder: [],
                playerDecks: [],
                startingLife: DEFAULT_STARTING_LIFE,
              });
              void get().listRooms();
              return;
            }
            const message = USER_FACING_ERROR_MESSAGES[payload.code as ServerErrorCode];
            toast.error(message ?? payload.message ?? `Server error: ${payload.code}`);
          }),
        );

        unsubscribers.push(
          platform.events.on<DisconnectedPayload>("server:disconnected", (payload) => {
            if (payload?.terminal) {
              detachDraftPeer();
              teardownDraftHost();
              useMultiplayerDraftStore.getState().clear();
              set({
                connected: false,
                connecting: false,
                error: "Disconnected from server",
                playerId: null,
                currentRoom: null,
                gameStarted: false,
                playerOrder: [],
                playerDecks: [],
                startingLife: DEFAULT_STARTING_LIFE,
                rooms: [],
                players: [],
                reconnect: { phase: "idle", attempt: 0 },
              });
            }
          }),
        );

        unsubscribers.push(platform.events.on("server:state_update", () => {}));

        unsubscribers.push(platform.events.on("server:turn_changed", () => {}));

        return () => {
          unsubscribers.forEach((fn) => fn());
        };
      },
    }),
    { name: "server", enabled: import.meta.env.DEV },
  ),
);
