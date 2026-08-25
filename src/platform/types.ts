import type { EngineGameStats } from "@/lib/engineTelemetry";
import type {
  DraftConfig,
  EngineKind,
  GameFormat,
  RoomRelayEnvelope,
  SealedConfig,
} from "@/types/server";
import type { Deck } from "@/protocol/deck";
import type { DirectiveInput, Prompt, PromptOutput, ResumeRoomRequest } from "@/protocol";

export interface StartGameParams {
  deck: Deck;
  startingLife: number;
  commanderName: string | null;
  opponentDecks: Deck[] | null;
}

export interface StartMultiplayerGameParams {
  playerNames: string[];
  decks: Deck[];
  commanderNames: Array<string | null>;
  enginePlayerIndex: number;
  localIsHost: boolean;
  startingLife: number;
  format?: GameFormat | null;
  hostPlayerSlot?: string | null;
  botPlayerSlots?: string[];
}

export interface RespondParams {
  action: PromptOutput;
  playerSlot: string | null;
  promptId: number;
}

export interface SendDirectiveParams {
  playerSlot: string;
  directive: DirectiveInput;
}

export interface RestoreSnapshotParams {
  checkpointId: number;
}

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
  reconnectTimeoutS?: number;
  password?: string;
}

export interface JoinRoomParams {
  roomId: string;
  observe?: boolean;
  password?: string;
}

/** The wire request minus the token, which the transport holds from `RoomCreated`. */
export type ResumeRoomParams = Omit<ResumeRoomRequest, "resume_token">;

export interface SetReadyParams {
  ready: boolean;
}

export interface SetDeckSelectionParams {
  deckName: string;
  deck: Deck;
  publishedDeckId?: string;
  commanderName: string | null;
  avatar?: string;
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
  roomPassword?: string | null;
  /** Defaults to `"simple"` when omitted. */
  agent?: BotAgentKind;
}

export interface IGameApi {
  startGame(params: StartGameParams): Promise<string>;

  startMultiplayerGame(params: StartMultiplayerGameParams): Promise<void>;

  respond(params: RespondParams): Promise<void>;

  /** Fire-and-forget out-of-band player instruction (concede, …). */
  sendDirective(params: SendDirectiveParams): Promise<void>;

  endGame(): Promise<void>;

  restoreSnapshot(params: RestoreSnapshotParams): Promise<void>;

  getPrompt(): Promise<Prompt | null>;
}

export interface IServerApi {
  connect(params: ServerConnectParams): Promise<void>;
  disconnect(): Promise<void>;
  listRooms(): Promise<void>;
  listPlayers(): Promise<void>;
  createRoom(params: CreateRoomParams): Promise<string | null>;
  stopRoom(): Promise<void>;
  joinRoom(params: JoinRoomParams): Promise<void>;
  /** Re-register a room after the relay lost it (relay restart). Web-host only. */
  resumeRoom?(params: ResumeRoomParams): Promise<void>;
  leaveRoom(): Promise<void>;
  setReady(params: SetReadyParams): Promise<void>;
  setDeckSelection(params: SetDeckSelectionParams): Promise<void>;
  setFormat(params: SetFormatParams): Promise<void>;
  setMaxPlayers(params: SetMaxPlayersParams): Promise<void>;
  startGame(params?: StartServerGameParams): Promise<void>;
  endGame(gameId: string): Promise<void>;
  /** Fire-and-forget engine timings for a finished game. Analytics, not state. */
  reportEngineStats(stats: EngineGameStats, gameId?: string | null): Promise<void>;
  requestResync(): Promise<void>;
  broadcastState(state: Record<string, unknown>, targetPlayer?: string): Promise<void>;
  sendRoomMessage(message: RoomRelayEnvelope): Promise<void>;
  spawnAiBot(params: SpawnAiBotParams): Promise<void>;
  removeAiBot(username: string): Promise<void>;
}

export interface IStorageApi {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export interface IEventBus {
  on<T>(event: string, handler: (payload: T) => void): () => void;

  emit<T>(event: string, payload: T): void;
}

export interface IPlatformApi {
  readonly type: "tauri" | "web";

  init(): Promise<void>;

  readonly game: IGameApi;

  readonly storage: IStorageApi;

  readonly events: IEventBus;

  /**
   * Server API (multiplayer).
   * Only available on Tauri platform.
   */
  readonly server?: IServerApi;

  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;

  isSupported(feature: PlatformFeature): boolean;
}

export type PlatformFeature =
  | "multiplayer" // WebSocket-based multiplayer
  | "native-dialogs" // File open/save dialogs
  | "system-tray" // System tray integration
  | "auto-update" // In-app updates
  | "offline-play"; // Works without internet
