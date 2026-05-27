import type { Deck } from "@/types/manabrew";

export type GameFormat =
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

export interface RoomInfo {
  room_id: string;
  room_name: string;
  host: string;
  hosted: boolean;
  players: RoomPlayerInfo[];
  max_players: number;
  format: GameFormat;
  status: "Lobby" | "InGame";
}

export interface RoomPlayerInfo {
  username: string;
  ready: boolean;
  connected: boolean;
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
  state: unknown;
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
  | { kind: "prompt"; forPlayer: string; prompt: unknown }
  | { kind: "response"; fromPlayer: string; action: unknown }
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

export interface ServerErrorPayload {
  code: string;
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
