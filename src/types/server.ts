import type { Deck } from "@/types/manabrew";
import type { Prompt, PromptOutput, StateUpdate } from "@/protocol";
import type { DisplayEvent } from "@/protocol/display";

export type GameFormat =
  | "Any"
  | "Standard"
  | "Pioneer"
  | "Modern"
  | "Legacy"
  | "Vintage"
  | "Pauper"
  | "Commander"
  | "Brawl"
  | "Oathbreaker"
  | "Draft"
  | "Sealed";

/** Which pile a card lives in inside a `Deck`. Used by the deck
 *  builder's section validators (`lib/formats.ts`) — NOT a wire field.
 *  On the wire, each section is its own array on `Deck`. */
export type DeckSection =
  | "main"
  | "sideboard"
  | "commander"
  | "attractions"
  | "contraptions"
  | "schemes"
  | "planes";

export const DEFAULT_RECONNECT_TIMEOUT_S = 60;

export interface RoomInfo {
  room_id: string;
  room_name: string;
  host: string;
  hosted: boolean;
  official: boolean;
  password_protected: boolean;
  players: RoomPlayerInfo[];
  max_players: number;
  format: GameFormat;
  status: "Lobby" | "InGame";
  engine: EngineKind;
  reconnect_timeout_s: number;
  draft_config?: DraftConfig;
  sealed_config?: SealedConfig;
}

export type EngineKind = "Wasm" | "Java";

export interface SealedConfig {
  set_code: string;
  num_boosters: number;
  base_seed?: number;
}

export interface DraftConfig {
  set_code?: string;
  cube_id?: string;
  cube_name?: string;
  rounds: number;
  picks_per_pass: number;
  seed?: number;
  fill_with_bots: boolean;
}

export interface RoomPlayerInfo {
  username: string;
  ready: boolean;
  connected: boolean;
  is_bot?: boolean;
  selected_deck_name?: string;
}

export interface PlayerDeckInfo {
  username: string;
  deck_name: string;
  deck: Deck;
  commander_name?: string;
}

export interface PlayerInfo {
  username: string;
  player_id: string;
  connected: boolean;
  room_id?: string;
}

export interface AuthResultPayload {
  success: boolean;
  player_id: string | null;
  reconnected: boolean | null;
  error: string | null;
}

export interface RoomListPayload {
  rooms: RoomInfo[];
}

export interface PlayerListPayload {
  players: PlayerInfo[];
}

export interface RoomCreatedPayload {
  room_id: string;
  room_name: string;
}

export interface RoomUpdatePayload {
  room: RoomInfo;
}

export interface PlayerJoinedPayload {
  room_id: string;
  username: string;
}

export interface PlayerLeftPayload {
  room_id: string;
  username: string;
}

export interface PlayerConnectionPayload {
  username: string;
}

export interface ReadyChangedPayload {
  username: string;
  ready: boolean;
}

export interface GameStartedPayload {
  room_id: string;
  player_order: string[];
  player_decks: PlayerDeckInfo[];
  starting_life: number;
}

export interface StateUpdatePayload {
  from_player: string;
  state: StateEnvelope;
}

export interface GameAbortedPayload {
  room_id: string;
}

export const ROOM_RELAY_KIND = "roomRelay" as const;

export interface RoomRelayEnvelope<TPayload = unknown> {
  kind: typeof ROOM_RELAY_KIND;
  protocol: string;
  version: 1;
  messageId: string;
  fromPlayer?: string;
  targetPlayer?: string;
  roomId?: string;
  payload: TPayload;
}

export type StateEnvelope =
  | { kind: "state"; state: StateUpdate }
  | { kind: "display"; event: DisplayEvent }
  | { kind: "prompt"; forPlayer: string; prompt: Prompt }
  | { kind: "response"; fromPlayer: string; action: PromptOutput }
  | { kind: "log"; fromPlayer: string; entry: unknown }
  | { kind: "snapshot"; fromPlayer: string; entry: unknown }
  | RoomRelayEnvelope;

export interface RoomMessagePayload<TPayload = unknown> {
  from_player: string;
  state: RoomRelayEnvelope<TPayload>;
}

export function isRoomRelayEnvelope(value: unknown): value is RoomRelayEnvelope {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RoomRelayEnvelope>;
  return (
    candidate.kind === ROOM_RELAY_KIND &&
    typeof candidate.protocol === "string" &&
    candidate.version === 1 &&
    typeof candidate.messageId === "string" &&
    "payload" in candidate
  );
}

export interface TurnChangedPayload {
  from_player: string;
  new_active_player: string;
  turn_number: number;
}

export const SERVER_ERROR_CODE = {
  AuthFailed: "auth_failed",
  AuthTimeout: "auth_timeout",
  RoomNotFound: "room_not_found",
  RoomFull: "room_full",
  IncorrectPassword: "incorrect_password",
  NotInRoom: "not_in_room",
  NotHost: "not_host",
  PlayersNotReady: "players_not_ready",
  DeckNotSelected: "deck_not_selected",
  GameAlreadyStarted: "game_already_started",
  GameNotInProgress: "game_not_in_progress",
  FormatNotChosen: "format_not_chosen",
  InvalidDraftConfig: "invalid_draft_config",
  AlreadyInRoom: "already_in_room",
  DuplicateUsername: "duplicate_username",
  WebSocket: "websocket_error",
  Parse: "parse_error",
} as const;

export type ServerErrorCode = (typeof SERVER_ERROR_CODE)[keyof typeof SERVER_ERROR_CODE];

export const START_GAME_FAILURE_CODES: ReadonlySet<ServerErrorCode> = new Set([
  SERVER_ERROR_CODE.FormatNotChosen,
  SERVER_ERROR_CODE.DeckNotSelected,
  SERVER_ERROR_CODE.NotHost,
  SERVER_ERROR_CODE.PlayersNotReady,
  SERVER_ERROR_CODE.GameAlreadyStarted,
  SERVER_ERROR_CODE.RoomNotFound,
  SERVER_ERROR_CODE.NotInRoom,
]);

export const USER_FACING_ERROR_MESSAGES: Partial<Record<ServerErrorCode, string>> = {
  [SERVER_ERROR_CODE.DeckNotSelected]: "Select a deck before getting ready",
  [SERVER_ERROR_CODE.PlayersNotReady]: "Not all players are ready",
  [SERVER_ERROR_CODE.NotHost]: "Only the host can do that",
  [SERVER_ERROR_CODE.RoomFull]: "Room is full",
  [SERVER_ERROR_CODE.IncorrectPassword]: "Incorrect room password",
  [SERVER_ERROR_CODE.AlreadyInRoom]: "You're already in a room",
  [SERVER_ERROR_CODE.FormatNotChosen]: "Choose a format before starting",
  [SERVER_ERROR_CODE.InvalidDraftConfig]: "Draft config is invalid",
};

export interface ServerErrorPayload {
  code: ServerErrorCode | string;
  message: string;
}

export type ReconnectPhase = "idle" | "reconnecting" | "failed";

export interface ReconnectingPayload {
  phase: ReconnectPhase;
  attempt: number;
  delayMs?: number;
  reason?: "network" | "server-shutdown";
}

export interface DisconnectedPayload {
  terminal?: boolean;
}
