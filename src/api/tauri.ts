/**
 * Typed wrappers for Tauri backend commands.
 * Centralizes all invoke() calls for type safety and maintainability.
 *
 * Note: These exports are the typed API layer for future migration.
 * They provide type-safe wrappers around Tauri invoke() calls.
 */
import { invoke } from "@tauri-apps/api/core";
import type { GameFormat } from "@/types/server";
import type { Deck } from "@/protocol/deck";
import { expandPresetDeckDefinitions, type PresetDeckDefinition } from "@/lib/presetDecks";

/**
 * Typed wrapper around Tauri's invoke that handles parameter conversion.
 * This centralizes the object → Record<string, unknown> cast needed by Tauri's API.
 */
function tauriInvoke<T>(cmd: string, args?: object): Promise<T> {
  return invoke<T>(cmd, args ? ({ ...args } as Record<string, unknown>) : undefined);
}

// ============================================================================
// Game Commands
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
  action: Record<string, unknown>;
  playerSlot: string | null;
}

export interface RestoreSnapshotParams {
  checkpointId: number;
}

export const gameCommands = {
  /**
   * Start a single-player game with specified deck and configuration.
   * @returns Game session identifier string
   */
  startGame: (params: StartGameParams) => tauriInvoke<string>("start_game", params),

  /**
   * Start a multiplayer game with multiple players and decks.
   */
  startMultiplayerGame: (params: StartMultiplayerGameParams) =>
    tauriInvoke<void>("start_multiplayer_game", params),

  /**
   * Send a player action/decision to the game engine.
   */
  respond: (params: RespondParams) => tauriInvoke<void>("respond", params),

  /**
   * End the current game session.
   */
  endGame: () => invoke<void>("end_game"),

  /**
   * Restore game state to a specific checkpoint.
   */
  restoreSnapshot: (params: RestoreSnapshotParams) => tauriInvoke<void>("restore_snapshot", params),
};

// ============================================================================
// Server Commands
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
}

export interface JoinRoomParams {
  roomId: string;
  observe?: boolean;
}

export interface SetReadyParams {
  ready: boolean;
}

export interface SetDeckSelectionParams {
  deckName: string;
  deck: Deck;
  commanderName: string | null;
}

export const serverCommands = {
  /**
   * Connect to an Manabrew server.
   * Triggers 'server:auth_result' event on completion.
   */
  connect: (params: ServerConnectParams) => tauriInvoke<void>("server_connect", params),

  /**
   * Disconnect from the current Manabrew server.
   */
  disconnect: () => invoke<void>("server_disconnect"),

  /**
   * Request list of available game rooms.
   * Triggers 'server:room_list' event with results.
   */
  listRooms: () => invoke<void>("server_list_rooms"),

  /**
   * Request list of connected players.
   * Triggers 'server:player_list' event with results.
   */
  listPlayers: () => invoke<void>("server_list_players"),

  /**
   * Create a new game room.
   * Triggers 'server:room_created' event on success.
   */
  createRoom: (params: CreateRoomParams) => tauriInvoke<void>("server_create_room", params),

  /**
   * Join an existing game room.
   * Triggers 'server:room_update' event with room state.
   */
  joinRoom: (params: JoinRoomParams) => tauriInvoke<void>("server_join_room", params),

  /**
   * Leave the current game room.
   */
  leaveRoom: () => invoke<void>("server_leave_room"),

  /**
   * Set ready status in current room.
   * Triggers 'server:ready_changed' event.
   */
  setReady: (params: SetReadyParams) => tauriInvoke<void>("server_set_ready", params),

  /**
   * Set deck selection for the current room.
   */
  setDeckSelection: (params: SetDeckSelectionParams) =>
    tauriInvoke<void>("server_set_deck_selection", params),

  /**
   * Start the game in the current room (host only).
   * Triggers 'server:game_started' event on success.
   */
  startGame: () => invoke<void>("server_start_game"),
};

// ============================================================================
// Deck & Utility Commands
// ============================================================================

export const deckCommands = {
  /**
   * Get list of available preset decks.
   */
  getPresetDecks: async (): Promise<Deck[]> =>
    expandPresetDeckDefinitions(await invoke<PresetDeckDefinition[]>("get_preset_decks")),
};

export const debugCommands = {
  /**
   * Get current game prompt (debug utility).
   */
  getPrompt: () => invoke<unknown>("get_prompt"),
};

// ============================================================================
// Consolidated API Export
// ============================================================================

/**
 * Centralized Tauri command API.
 * Use this instead of direct invoke() calls for type safety and discoverability.
 */
export const tauriApi = {
  game: gameCommands,
  server: serverCommands,
  deck: deckCommands,
  debug: debugCommands,
};
