import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { toast } from "sonner";
import { getPlatform } from "@/platform";
import { attachDraftPeer, detachDraftPeer } from "@/game/draftPeer";
import { teardownHost as teardownDraftHost } from "@/game/draftHost";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import {
  isActiveGameSessionAbandonmentPending,
  peekActiveGameSession,
} from "@/lib/activeGameSession";
import {
  claimTabSession,
  holdTabSession,
  probeTabSession,
  type TabSessionHolder,
} from "@/lib/tabSession";
import {
  DUPLICATE_USERNAME_ERROR_FRAGMENT,
  SERVER_ERROR_CODE,
  USER_FACING_ERROR_MESSAGES,
} from "@/types/server";
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
  hostingForgeRoom: boolean;
  players: PlayerInfo[];

  gameStarted: boolean;
  gameRoomId: string;
  gameId: string;
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
  resumeRoomAfterRestart(): Promise<void>;
  leaveRoom(requireServerLeave?: boolean): Promise<void>;
  setReady(ready: boolean): Promise<void>;
  setDeckSelection(
    deckName: string,
    deck: Deck,
    commanderName?: string,
    publishedDeckId?: string,
  ): Promise<void>;
  setFormat(format: GameFormat): Promise<void>;
  setMaxPlayers(maxPlayers: number): Promise<void>;
  startGame(format?: GameFormat): Promise<void>;
  endGame(): Promise<void>;

  setupListeners(): () => void;
}

export const JOIN_REJECTED_INCORRECT_PASSWORD = SERVER_ERROR_CODE.IncorrectPassword;

const JOIN_CONFIRM_TIMEOUT_MS = 7000;
const JOIN_FAILURE_CODES: ReadonlySet<ServerErrorCode> = new Set([
  SERVER_ERROR_CODE.RoomNotFound,
  SERVER_ERROR_CODE.RoomFull,
  SERVER_ERROR_CODE.IncorrectPassword,
  SERVER_ERROR_CODE.AlreadyInRoom,
  SERVER_ERROR_CODE.GameAlreadyStarted,
  SERVER_ERROR_CODE.AuthFailed,
  SERVER_ERROR_CODE.AuthTimeout,
  SERVER_ERROR_CODE.WebSocket,
]);

interface PendingJoin {
  roomId: string;
  settle: (error: Error | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

let pendingJoin: PendingJoin | null = null;

let tabSession: TabSessionHolder | null = null;

function releaseTabSession() {
  tabSession?.release();
  tabSession = null;
}

// The duplicate backoff in platform/web.ts only helps when the holder is a
// dead session the relay will reap. When the holder is alive (another tab of
// this browser, or another device), the retry loop can never win — stop it
// and tell the player instead.
const DUPLICATE_GIVE_UP_MS = 120_000;
let duplicateRejectionSince: number | null = null;

async function stopReconnectAsDuplicate(error: string) {
  duplicateRejectionSince = null;
  await getPlatform().server?.disconnect();
  useServerStore.setState({ connected: false, connecting: false, error });
  toast.info(error);
}

async function handleDuplicateRejection() {
  const username = useServerStore.getState().username;
  if (!username) return;
  if ((await probeTabSession(username)) === "held") {
    await stopReconnectAsDuplicate(
      "You are signed in in another tab of this browser. Close it, or connect here to take over.",
    );
    return;
  }
  duplicateRejectionSince ??= Date.now();
  if (Date.now() - duplicateRejectionSince >= DUPLICATE_GIVE_UP_MS) {
    await stopReconnectAsDuplicate(
      "Your username is still connected from somewhere else. Try again in a minute.",
    );
  }
}

function settlePendingJoin(error: Error | null, roomId?: string) {
  if (!pendingJoin) return false;
  if (roomId && pendingJoin.roomId !== roomId) return false;
  clearTimeout(pendingJoin.timer);
  const { settle } = pendingJoin;
  pendingJoin = null;
  settle(error);
  return true;
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
      hostingForgeRoom: false,
      players: [],
      gameStarted: false,
      gameRoomId: "",
      gameId: "",
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
        duplicateRejectionSince = null;
        releaseTabSession();
        const claim = await claimTabSession(username);
        if (claim.outcome === "refused") {
          set({
            connecting: false,
            error: "You are hosting a game in another tab. Finish or close it first.",
          });
          return;
        }
        try {
          await platform.server.connect({ host, port, username, password });
          tabSession = holdTabSession(username, {
            refusal: () =>
              get().gameStarted && get().currentRoom?.host === get().username ? "hosting" : null,
            onRelease: async () => {
              // The holder channel acks "released" after this resolves; null the
              // handle first so disconnect() doesn't close that channel mid-handover.
              tabSession = null;
              await get().disconnect();
              toast.info("Signed in from another tab — this tab was disconnected.");
            },
          });
        } catch (e) {
          set({ connecting: false, error: String(e) });
        }
      },

      async disconnect() {
        duplicateRejectionSince = null;
        releaseTabSession();
        const platform = getPlatform();
        if (!platform.server) return;
        await platform.server.disconnect();
        set({
          connected: false,
          connecting: false,
          error: null,
          playerId: null,
          username: null,
          reconnect: { phase: "idle", attempt: 0 },
          currentRoom: null,
          roomPassword: null,
          hostingForgeRoom: false,
          gameStarted: false,
          gameRoomId: "",
          gameId: "",
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
          if (engine === "Forge") set({ hostingForgeRoom: true });
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

      async resumeRoomAfterRestart() {
        const platform = getPlatform();
        const { currentRoom, gameId, playerOrder, playerDecks, startingLife, roomPassword } = get();
        if (!platform.server?.resumeRoom || !currentRoom || playerOrder.length === 0 || !gameId)
          return;
        await platform.server.resumeRoom({
          room_id: currentRoom.room_id,
          room_name: currentRoom.room_name,
          max_players: currentRoom.max_players,
          format: currentRoom.format,
          hosted: currentRoom.hosted,
          engine: "Manabrew",
          password: roomPassword ?? undefined,
          reconnect_timeout_s: currentRoom.reconnect_timeout_s,
          draft_config: currentRoom.draft_config,
          sealed_config: currentRoom.sealed_config,
          player_order: playerOrder,
          player_decks: playerDecks,
          starting_life: startingLife,
          bot_players: currentRoom.players.filter((p) => p.is_bot).map((p) => p.username),
          game_id: gameId,
        });
      },

      async leaveRoom(requireServerLeave = false) {
        const platform = getPlatform();
        if (requireServerLeave) {
          if (!platform.server) throw new Error("Multiplayer server is unavailable.");
          await platform.server.leaveRoom();
        }

        teardownDraftHost();
        useMultiplayerDraftStore.getState().clear();
        set({
          currentRoom: null,
          roomPassword: null,
          hostingForgeRoom: false,
          gameStarted: false,
          gameRoomId: "",
          gameId: "",
          playerOrder: [],
          playerDecks: [],
          startingLife: DEFAULT_STARTING_LIFE,
        });
        if (!platform.server) return;
        if (!requireServerLeave) {
          try {
            await platform.server.leaveRoom();
          } catch (e) {
            console.warn("server.leaveRoom() failed:", e);
          }
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

      async setDeckSelection(deckName, deck, commanderName, publishedDeckId) {
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
          publishedDeckId,
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
        await platform.server.endGame(get().gameId);
      },

      setupListeners() {
        const platform = getPlatform();
        if (!platform.server) {
          return () => {}; // No-op cleanup for platforms without server support
        }

        const unsubscribers: (() => void)[] = [];

        unsubscribers.push(
          platform.events.on<AuthResultPayload>("server:auth_result", (payload) => {
            if (payload.success) {
              duplicateRejectionSince = null;
              set({
                connected: true,
                connecting: false,
                error: null,
                playerId: payload.player_id,
                username: payload.username ?? get().username,
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
              if (payload.error?.includes(DUPLICATE_USERNAME_ERROR_FRAGMENT))
                void handleDuplicateRejection();
            }
          }),
        );

        unsubscribers.push(
          platform.events.on("server:session_taken_over", () => {
            void stopReconnectAsDuplicate(
              "You connected as this player somewhere else. This session was signed out.",
            );
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
          platform.events.on<RoomCreatedPayload>("server:room_created", (payload) => {
            set({ currentRoom: payload.room });
            get().listRooms();
          }),
        );

        unsubscribers.push(
          platform.events.on<RoomUpdatePayload>("server:room_update", (payload) => {
            // Only rooms we are in or joining: an update broadcast while our
            // LeaveRoom was in flight must not re-enroll us in the room.
            const inRoom = get().currentRoom?.room_id === payload.room.room_id;
            const joining = pendingJoin?.roomId === payload.room.room_id;
            const reclaiming =
              !isActiveGameSessionAbandonmentPending() &&
              peekActiveGameSession()?.roomId === payload.room.room_id;
            if (inRoom || joining || reclaiming) {
              set({ currentRoom: payload.room });
            }
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
            const roomId = get().currentRoom?.room_id;
            if (roomId && payload.room_id !== roomId) return;
            set({
              gameStarted: true,
              gameRoomId: payload.room_id,
              gameId: payload.game_id,
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
            if (
              JOIN_FAILURE_CODES.has(payload.code as ServerErrorCode) &&
              settlePendingJoin(new Error(payload.code))
            )
              return;
            if (payload.code === SERVER_ERROR_CODE.NotInRoom) {
              set({
                currentRoom: null,
                gameStarted: false,
                gameRoomId: "",
                gameId: "",
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
              settlePendingJoin(new Error("disconnected"));
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
                gameRoomId: "",
                gameId: "",
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
