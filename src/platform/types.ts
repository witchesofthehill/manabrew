/**
 * Platform abstraction interfaces.
 *
 * These interfaces define the contract between the React frontend and
 * the backend (Tauri or WASM). This allows the same frontend code to
 * work with both desktop (Tauri) and web (WASM) deployments.
 */

import type {
  DraftConfig,
  EngineKind,
  GameFormat,
  RoomRelayEnvelope,
  SealedConfig,
} from "@/types/server";
import type { Deck } from "@/types/manabrew";
import type { Prompt, PromptOutput } from "@/protocol";

// ============================================================================
// Game API Types
// ============================================================================

export interface StartGameParams {
  deck: Deck;
  startingLife: number;
  commanderName: string | null;
  opponentDeck: Deck | null;
}

export interface StartMultiplayerGameParams {
  playerNames: string[];
  decks: Deck[];
  commanderNames: Array<string | null>;
  enginePlayerIndex: number;
  localIsHost: boolean;
  startingLife: number;
}

export interface RespondParams {
  action: PromptOutput;
  playerSlot: string | null;
}

export interface RestoreSnapshotParams {
  checkpointId: number;
}

// ============================================================================
// Server API Types
// ============================================================================

export interface ServerConnectParams {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface CreateRoomParams {
  roomName: string;
  maxPlayers: number;
  format: GameFormat;
  hosted?: boolean;
  engine?: EngineKind;
  draftConfig?: DraftConfig;
  sealedConfig?: SealedConfig;
}

export interface JoinRoomParams {
  roomId: string;
  observe?: boolean;
  password?: string;
}

export interface SetReadyParams {
  ready: boolean;
}

export interface SetDeckSelectionParams {
  deckName: string;
  deck: Deck;
  commanderName: string | null;
}

export interface StartServerGameParams {
  format?: GameFormat;
}

export interface SetFormatParams {
  format: GameFormat;
}

export interface SetMaxPlayersParams {
  maxPlayers: number;
}

export type BotAgentKind = "simple";

export interface SpawnAiBotParams extends SetDeckSelectionParams {
  roomId: string;
  username: string;
  /** Defaults to `"simple"` when omitted. */
  agent?: BotAgentKind;
}

// ============================================================================
// Platform Interfaces
// ============================================================================

/**
 * Game engine API interface.
 * Abstracts game operations for both Tauri and WASM backends.
 */
export interface IGameApi {
  /** Start a single-player game */
  startGame(params: StartGameParams): Promise<string>;

  /** Start a multiplayer game */
  startMultiplayerGame(params: StartMultiplayerGameParams): Promise<void>;

  /** Send a player action to the engine */
  respond(params: RespondParams): Promise<void>;

  /** End the current game */
  endGame(): Promise<void>;

  /** Restore game to a checkpoint */
  restoreSnapshot(params: RestoreSnapshotParams): Promise<void>;

  /** Get preset deck list */
  getPresetDecks(): Promise<Deck[]>;

  /** Get current prompt (for debugging/polling) */
  getPrompt(): Promise<Prompt | null>;
}

/**
 * Multiplayer server API interface.
 * Only available on Tauri platform (server requires WebSocket).
 */
export interface IServerApi {
  connect(params: ServerConnectParams): Promise<void>;
  disconnect(): Promise<void>;
  listRooms(): Promise<void>;
  listPlayers(): Promise<void>;
  createRoom(params: CreateRoomParams): Promise<void>;
  joinRoom(params: JoinRoomParams): Promise<void>;
  leaveRoom(): Promise<void>;
  setReady(params: SetReadyParams): Promise<void>;
  setDeckSelection(params: SetDeckSelectionParams): Promise<void>;
  setFormat(params: SetFormatParams): Promise<void>;
  setMaxPlayers(params: SetMaxPlayersParams): Promise<void>;
  startGame(params?: StartServerGameParams): Promise<void>;
  endGame(): Promise<void>;
  broadcastState(state: Record<string, unknown>): Promise<void>;
  sendRoomMessage(message: RoomRelayEnvelope): Promise<void>;
  spawnAiBot(params: SpawnAiBotParams): Promise<void>;
  removeAiBot(username: string): Promise<void>;
}

/**
 * Storage API interface.
 * Provides persistent storage for decks, preferences, etc.
 */
export interface IStorageApi {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/**
 * Event bus interface.
 * Handles communication from backend to frontend.
 */
export interface IEventBus {
  /**
   * Subscribe to an event.
   * @returns Unsubscribe function
   */
  on<T>(event: string, handler: (payload: T) => void): () => void;

  /**
   * Emit an event (for local dispatch).
   */
  emit<T>(event: string, payload: T): void;
}

/**
 * Main platform API interface.
 * Entry point for all platform-specific functionality.
 */
export interface IPlatformApi {
  /** Platform identifier */
  readonly type: "tauri" | "web";

  /** Game engine API */
  readonly game: IGameApi;

  /** Storage API */
  readonly storage: IStorageApi;

  /** Event bus for backend → frontend communication */
  readonly events: IEventBus;

  /**
   * Server API (multiplayer).
   * Only available on Tauri platform.
   */
  readonly server?: IServerApi;

  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;

  /**
   * Check if a feature is supported.
   */
  isSupported(feature: PlatformFeature): boolean;
}

/**
 * Platform features that may have different support levels.
 */
export type PlatformFeature =
  | "multiplayer" // WebSocket-based multiplayer
  | "native-dialogs" // File open/save dialogs
  | "system-tray" // System tray integration
  | "auto-update" // In-app updates
  | "offline-play"; // Works without internet
