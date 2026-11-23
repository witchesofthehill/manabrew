import type { BoardBackgroundId } from "@/pixi/board/boardBackgrounds";
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { toast } from "sonner";
import { getPlatform } from "@/platform";
import { findLanRelay, type LanTarget } from "@/lib/lanRelay";
import { setLanCacheHost, setRelayCacheBase } from "@/lib/lanCache";
import { attachDraftPeer, detachDraftPeer, requestDraftResync } from "@/game/draftPeer";
import { teardownHost as teardownDraftHost } from "@/game/draftHost";
import { useMultiplayerDraftStore } from "@/stores/useMultiplayerDraftStore";
import {
  attachLimitedSessionPeer,
  clearLimitedSession,
  requestLimitedResync,
} from "@/game/limitedSession";
import { clearSealedStart } from "@/game/sealedStart";
import { useMultiplayerLimitedStore } from "@/stores/useMultiplayerLimitedStore";
import { usePreferencesStore } from "@/stores/usePreferencesStore";
import { assetUrlById } from "@/stores/useAssetStore";
import { useAuthStore } from "@/stores/useAuthStore";
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
import { stripUsernameTag } from "@/lib/username";
import {
  CHAT_ERROR_CODES,
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
  RelayFeature,
  RematchIntent,
} from "@/types/server";
import type { Deck } from "@/protocol/deck";
import { resendLocalGame } from "@/lib/localGamePresence";
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
  relayFeatures: string[];
  /** Set when the session is on a relay or room found on this network rather
   *  than the configured one, for the lobby to say so. */
  lanTarget: LanTarget | null;
  switchingRelay: boolean;

  rooms: RoomInfo[];
  currentRoom: RoomInfo | null;
  leavingRoomId: string | null;
  roomPassword: string | null;
  hostingForgeRoom: boolean;
  players: PlayerInfo[];
  gameStarted: boolean;
  gameRoomId: string;
  gameId: string;
  playerOrder: string[];
  playerDecks: PlayerDeckInfo[];
  startingLife: number;
  connect(
    host: string,
    port: number,
    username: string,
    password: string,
    lan?: boolean,
  ): Promise<void>;
  /** The configured relay, unless one is answering on this network: that is
   *  the network's lobby and wins. */
  connectPreferred(username: string): Promise<void>;
  /** Record that the session is on `target`, and read its cache from it. */
  adoptLanTarget(target: LanTarget | null): void;
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
    tableStyle?: BoardBackgroundId,
  ): Promise<void>;
  joinRoom(roomId: string, password?: string, observe?: boolean): Promise<void>;
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
  setRematchIntent(intent: RematchIntent): Promise<void>;
  returnToLobby(): Promise<void>;
  inviteToRoom(username: string): Promise<void>;
  hasRelayFeature(feature: RelayFeature): boolean;
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
let pendingLeave: Promise<void> | null = null;
let pendingRoomDeparture: Promise<void> | null = null;
let requestedLeaveRoomId: string | null = null;
let tabSession: TabSessionHolder | null = null;
function releaseTabSession() {
  tabSession?.release();
  tabSession = null;
}
// The duplicate backoff in platform/web.ts only helps when the holder is a
// dead session the relay will reap. When the holder is alive (another tab of
// this browser, or another device), the retry loop can never win — stop it
// and tell the player instead.
const DUPLICATE_GIVE_UP_MS = 120000;
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
      `You are signed in in another tab of this browser. Close it, or connect here to take over.`,
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

function reconcileRoomMembership() {
  const state = useServerStore.getState();
  if (state.currentRoom || state.leavingRoomId || isActiveGameSessionAbandonmentPending()) return;
  const roomId = state.players.find((player) => player.player_id === state.playerId)?.room_id;
  const matchReturn = useMultiplayerLimitedStore.getState().matchReturn;
  if (matchReturn && matchReturn.roomId !== roomId) return;
  const room = state.rooms.find((room) => room.room_id === roomId);
  if (room) useServerStore.setState({ currentRoom: room });
}

function confirmRoomLeave(): Promise<void> {
  const state = useServerStore.getState();
  if (!state.leavingRoomId) return Promise.resolve();
  if (pendingLeave) return pendingLeave;
  if (!state.connected) return Promise.reject(new Error("Cannot leave room while disconnected."));
  requestedLeaveRoomId = null;
  pendingLeave = new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      unsubscribe();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error("The server has not confirmed leaving the room. Please try again.")),
      JOIN_CONFIRM_TIMEOUT_MS,
    );
    const unsubscribe = useServerStore.subscribe((next) => {
      if (!next.connected) finish(new Error("Disconnected while leaving the room."));
      else if (!next.leavingRoomId) finish();
    });
    void state.listPlayers().catch((error) => finish(new Error(String(error))));
  }).finally(() => {
    pendingLeave = null;
  });
  return pendingLeave;
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
      relayFeatures: [],
      lanTarget: null,
      switchingRelay: false,
      rooms: [],
      currentRoom: null,
      leavingRoomId: null,
      roomPassword: null,
      hostingForgeRoom: false,
      players: [],
      gameStarted: false,
      gameRoomId: "",
      gameId: "",
      playerOrder: [],
      playerDecks: [],
      startingLife: DEFAULT_STARTING_LIFE,
      async connect(host, port, username, password, lan) {
        const platform = getPlatform();
        if (!platform.server) {
          set({ connecting: false, error: "Multiplayer not supported on this platform" });
          return;
        }
        set({ username, connecting: true, error: null });
        get().adoptLanTarget(null);
        duplicateRejectionSince = null;
        releaseTabSession();
        const claim = await claimTabSession(username);
        if (claim.outcome === "refused") {
          set({
            connecting: false,
            error: `You are hosting a game in another tab. Finish or close it first.`,
          });
        }
        try {
          await platform.server.connect({ host, port, username, password, lan });
          tabSession = holdTabSession(username, {
            refusal: () =>
              get().gameStarted && get().currentRoom?.host === get().username ? "hosting" : null,
            onRelease: async () => {
              // The holder channel acks "released" after this resolves; null the
              // handle first so disconnect() doesn't close that channel mid-handover.
              tabSession = null;
              await get().disconnect();
              toast.info(`Signed in from another tab \u2014 this tab was disconnected.`);
            },
          });
        } catch (e) {
          set({ connecting: false, error: String(e) });
        }
      },

      // Decided where the first connection is made. The home screen connects
      // as soon as it opens, and a lookup that lived only in the lobby ran
      // after that, when there was nothing left to decide.
      async connectPreferred(username) {
        if (get().connected || get().connecting || get().switchingRelay) return;
        set({ connecting: true, error: null });
        const found = await findLanRelay();
        const prefs = usePreferencesStore.getState();
        if (found) {
          await get().connect(found.host, found.port, username, found.password, true);
          if (!get().error) get().adoptLanTarget(found);
        } else {
          await get().connect(prefs.serverHost, prefs.serverPort, username, prefs.serverPassword);
        }
      },

      adoptLanTarget(target) {
        set({ lanTarget: target });
        // A host reads its own cache; only a guest has somewhere better to ask.
        const guestOf = target && !target.hosting ? target : null;
        setLanCacheHost(guestOf?.host ?? null, guestOf?.artPort);
      },

      async disconnect() {
        duplicateRejectionSince = null;
        releaseTabSession();
        const platform = getPlatform();
        if (!platform.server) return;
        teardownDraftHost();
        clearLimitedSession();
        clearSealedStart();
        await platform.server.disconnect();
        get().adoptLanTarget(null);
        setRelayCacheBase(null);
        set({
          connected: false,
          connecting: false,
          error: null,
          playerId: null,
          username: null,
          reconnect: { phase: "idle", attempt: 0 },
          currentRoom: null,
          leavingRoomId: null,
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
        tableStyle,
      ) {
        const platform = getPlatform();
        if (!platform.server) return;
        await pendingRoomDeparture;
        await confirmRoomLeave();
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
          tableStyle,
        });
        if (roomId) {
          if (engine === "Forge") set({ hostingForgeRoom: true });
          await get().joinRoom(roomId, password);
        }
      },
      async joinRoom(roomId, password, observe = false) {
        const platform = getPlatform();
        if (!platform.server) return;
        await pendingRoomDeparture;
        await confirmRoomLeave();
        settlePendingJoin(new Error("join_superseded"));
        set({ roomPassword: password ? password : null });
        await platform.server.joinRoom({ roomId, password, observe });
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
        if (observe) {
          try {
            await new Promise<void>((resolve, reject) => {
              const finish = (error?: Error) => {
                clearTimeout(timer);
                offStarted();
                offError();
                if (error) reject(error);
                else resolve();
              };
              const offStarted = platform.events.on<GameStartedPayload>(
                "server:game_started",
                (payload) => {
                  if (payload.room_id === roomId) finish();
                },
              );
              const offError = platform.events.on<ServerErrorPayload>("server:error", (payload) => {
                if (
                  payload.code === SERVER_ERROR_CODE.GameNotInProgress ||
                  payload.code === SERVER_ERROR_CODE.NotInRoom
                )
                  finish(new Error(payload.code));
              });
              const timer = setTimeout(
                () => finish(new Error("watch_timeout")),
                JOIN_CONFIRM_TIMEOUT_MS,
              );
              void platform.server!.requestResync().catch(finish);
            });
          } catch (error) {
            if (get().currentRoom?.room_id === roomId) await get().leaveRoom();
            throw error;
          }
        }
      },
      async resumeRoomAfterRestart() {
        const platform = getPlatform();
        const { currentRoom, gameId, playerOrder, playerDecks, startingLife, roomPassword } = get();
        if (!platform.server?.resumeRoom || !currentRoom || playerOrder.length === 0 || !gameId)
          return;
        const seatIndices = playerOrder.map(
          (username) =>
            currentRoom.players.find((player) => player.username === username)?.seat_index,
        );
        await platform.server.resumeRoom({
          room_id: currentRoom.room_id,
          room_name: currentRoom.room_name,
          max_players: currentRoom.max_players,
          format: currentRoom.format,
          hosted: currentRoom.hosted,
          allow_spectators: currentRoom.allow_spectators,
          engine: currentRoom.engine,
          password: roomPassword ?? undefined,
          reconnect_timeout_s: currentRoom.reconnect_timeout_s,
          table_style: currentRoom.table_style,
          draft_config: currentRoom.draft_config,
          sealed_config: currentRoom.sealed_config,
          player_order: playerOrder,
          seat_indices: seatIndices.every((seat): seat is number => seat !== undefined)
            ? seatIndices
            : undefined,
          player_decks: playerDecks,
          starting_life: startingLife,
          bot_players: currentRoom.players.filter((p) => p.is_bot).map((p) => p.username),
          game_id: gameId,
        });
      },
      leaveRoom(requireServerLeave = false) {
        if (pendingRoomDeparture) return pendingRoomDeparture;
        pendingRoomDeparture = (async () => {
          const platform = getPlatform();
          set({
            leavingRoomId:
              get().leavingRoomId ??
              get().currentRoom?.room_id ??
              pendingJoin?.roomId ??
              get().players.find((player) => player.player_id === get().playerId)?.room_id ??
              (get().gameRoomId || null),
          });
          settlePendingJoin(new Error("join_cancelled"));
          if (requireServerLeave) {
            if (!platform.server) throw new Error("Multiplayer server is unavailable.");
            await platform.server.leaveRoom();
            await confirmRoomLeave();
          }
          teardownDraftHost();
          useMultiplayerDraftStore.getState().clear();
          clearLimitedSession();
          clearSealedStart();
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
          if (!requireServerLeave) {
            try {
              await confirmRoomLeave();
            } catch (e) {
              console.warn("Room departure is pending:", e);
            }
          }
          try {
            await get().listRooms();
          } catch (e) {
            console.warn("listRooms() after leaveRoom failed:", e);
          }
        })().finally(() => {
          pendingRoomDeparture = null;
        });
        return pendingRoomDeparture;
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
        const deckHasPlaymat = !!deck.playmatUrl || !!deck.playmatSettings?.color;
        const defaultPlaymatUrl = deckHasPlaymat
          ? undefined
          : await assetUrlById(prefs.defaultPlaymatAssetId);
        await platform.server.setDeckSelection({
          deckName,
          deck: deckHasPlaymat
            ? deck
            : {
                ...deck,
                playmatUrl: defaultPlaymatUrl,
                playmatAssetId: defaultPlaymatUrl ? prefs.defaultPlaymatAssetId : undefined,
                playmatSettings: prefs.defaultPlaymatSettings,
              },
          publishedDeckId,
          commanderName: commanderName ?? null,
          avatarUrl: useAuthStore.getState().account?.avatarUrl,
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
      async setRematchIntent(intent) {
        const server = getPlatform().server;
        const rematch = get().currentRoom?.rematch;
        if (!server || !rematch || !get().hasRelayFeature("game_rematch")) {
          throw new Error("This table does not support rematches. Update the server.");
        }
        await server.setRematchIntent(rematch.game_id, intent);
      },
      async returnToLobby() {
        const server = getPlatform().server;
        const rematch = get().currentRoom?.rematch;
        if (!server || !rematch || !get().hasRelayFeature("game_rematch")) {
          throw new Error("This table does not support rematches. Update the server.");
        }
        await server.returnToLobby(rematch.game_id);
      },
      async inviteToRoom(username) {
        const platform = getPlatform();
        if (!platform.server) return;
        await platform.server.inviteToRoom({ username });
        toast.success(`Invited ${stripUsernameTag(username)} to your table`);
      },
      hasRelayFeature(feature) {
        return get().relayFeatures.includes(feature);
      },
      setupListeners() {
        const platform = getPlatform();
        if (!platform.server) {
          return () => {}; // No-op cleanup for platforms without server support
        }
        const unsubscribers: (() => void)[] = [];
        unsubscribers.push(
          platform.events.on<AuthResultPayload>("server:auth_result", (payload) => {
            set({ relayFeatures: payload.features ?? [] });
            setRelayCacheBase(payload.success ? (payload.art_base_url ?? null) : null);
            if (payload.success) {
              duplicateRejectionSince = null;
              requestedLeaveRoomId = null;
              set({
                connected: true,
                connecting: false,
                error: null,
                playerId: payload.player_id,
                username: payload.username ?? get().username,
                players: [],
                reconnect: { phase: "idle", attempt: 0 },
              });
              get().listRooms();
              get().listPlayers();
              resendLocalGame();
              const username = get().username;
              if (username) {
                attachDraftPeer(username);
                attachLimitedSessionPeer();
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
            reconcileRoomMembership();
          }),
        );
        unsubscribers.push(
          platform.events.on<PlayerListPayload>("server:player_list", (payload) => {
            set({ players: payload.players });
            const { playerId, leavingRoomId } = get();
            const player = payload.players.find((player) => player.player_id === playerId);
            if (leavingRoomId && player) {
              if (player.room_id === leavingRoomId) {
                if (requestedLeaveRoomId !== leavingRoomId && get().connected) {
                  requestedLeaveRoomId = leavingRoomId;
                  void platform
                    .server!.leaveRoom()
                    .then(() => get().listPlayers())
                    .catch((error) => console.warn("server.leaveRoom() failed:", error));
                }
              } else {
                set({
                  leavingRoomId: null,
                  currentRoom:
                    get().currentRoom?.room_id === leavingRoomId ? null : get().currentRoom,
                });
              }
            }
            reconcileRoomMembership();
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
            if (get().leavingRoomId === payload.room.room_id) return;
            // Only rooms we are in or joining: an update broadcast while our
            // LeaveRoom was in flight must not re-enroll us in the room.
            const inRoom = get().currentRoom?.room_id === payload.room.room_id;
            const joining = pendingJoin?.roomId === payload.room.room_id;
            const restored =
              !isActiveGameSessionAbandonmentPending() &&
              get().players.find((player) => player.player_id === get().playerId)?.room_id ===
                payload.room.room_id;
            const limited = useMultiplayerLimitedStore.getState();
            const draft = useMultiplayerDraftStore.getState();
            const reclaiming =
              !isActiveGameSessionAbandonmentPending() &&
              (peekActiveGameSession()?.roomId === payload.room.room_id ||
                limited.originalRoom?.room_id === payload.room.room_id ||
                limited.matchReturn?.roomId === payload.room.room_id ||
                draft.roomId === payload.room.room_id);
            if (inRoom || joining || reclaiming || restored) {
              if (!limited.matchReturn || limited.matchReturn.roomId === payload.room.room_id)
                set({ currentRoom: payload.room });
              if (limited.originalRoom?.room_id === payload.room.room_id) {
                useMultiplayerLimitedStore.setState({ originalRoom: payload.room });
              }
              if (
                payload.room.status === "InGame" &&
                (payload.room.draft_config || payload.room.sealed_config) &&
                payload.room.host !== get().username
              ) {
                void requestDraftResync();
                void requestLimitedResync();
              }
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
            if (get().leavingRoomId === payload.room_id) return;
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
            if (payload.code === SERVER_ERROR_CODE.GameNotInProgress) {
              settlePendingJoin(new Error(payload.code));
              return;
            }
            if (CHAT_ERROR_CODES.has(payload.code as ServerErrorCode)) return;
            if (payload.code === SERVER_ERROR_CODE.AlreadyInRoom) {
              void get().listPlayers();
              void get().listRooms();
            }
            if (
              JOIN_FAILURE_CODES.has(payload.code as ServerErrorCode) &&
              settlePendingJoin(new Error(payload.code))
            )
              return;
            if (payload.code === SERVER_ERROR_CODE.NotInRoom) {
              set({
                currentRoom: null,
                leavingRoomId: null,
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
            toast.error(message ?? `Server error: ${payload.code}`);
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
                leavingRoomId: null,
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
