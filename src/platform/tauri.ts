/**
 * Tauri platform implementation.
 *
 * This wraps the existing Tauri API to conform to the platform interface.
 * It's the backend used for desktop (macOS, Windows, Linux) deployments.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Deck } from "@/types/manabrew";
import type { Prompt } from "@/protocol";
import { expandPresetDeckDefinitions, type PresetDeckDefinition } from "@/lib/presetDecks";

import type {
  IPlatformApi,
  IGameApi,
  IServerApi,
  IStorageApi,
  IEventBus,
  PlatformFeature,
  StartGameParams,
  StartMultiplayerGameParams,
  RespondParams,
  RestoreSnapshotParams,
  ServerConnectParams,
  CreateRoomParams,
  JoinRoomParams,
  SetReadyParams,
  SetDeckSelectionParams,
  StartServerGameParams,
  SetFormatParams,
  SetMaxPlayersParams,
  SpawnAiBotParams,
} from "./types";
import type { RoomRelayEnvelope } from "@/types/server";

// ============================================================================
// Tauri Game API
// ============================================================================

class TauriGameApi implements IGameApi {
  async startGame(params: StartGameParams): Promise<string> {
    return invoke<string>("start_game", {
      deck: params.deck,
      startingLife: params.startingLife,
      commanderName: params.commanderName,
      opponentDeck: params.opponentDeck,
    });
  }

  async startMultiplayerGame(params: StartMultiplayerGameParams): Promise<void> {
    return invoke<void>("start_multiplayer_game", {
      playerNames: params.playerNames,
      decks: params.decks,
      commanderNames: params.commanderNames,
      enginePlayerIndex: params.enginePlayerIndex,
      localIsHost: params.localIsHost,
      startingLife: params.startingLife,
    });
  }

  async respond(params: RespondParams): Promise<void> {
    return invoke<void>("respond", {
      action: params.action,
      playerSlot: params.playerSlot,
    });
  }

  async endGame(): Promise<void> {
    return invoke<void>("end_game");
  }

  async restoreSnapshot(params: RestoreSnapshotParams): Promise<void> {
    return invoke<void>("restore_snapshot", {
      checkpointId: params.checkpointId,
    });
  }

  async getPresetDecks(): Promise<Deck[]> {
    return expandPresetDeckDefinitions(await invoke<PresetDeckDefinition[]>("get_preset_decks"));
  }

  async getPrompt(): Promise<Prompt | null> {
    return invoke<Prompt | null>("get_prompt");
  }
}

// ============================================================================
// Tauri Server API
// ============================================================================

class TauriServerApi implements IServerApi {
  async connect(params: ServerConnectParams): Promise<void> {
    return invoke<void>("server_connect", { ...params });
  }

  async disconnect(): Promise<void> {
    return invoke<void>("server_disconnect");
  }

  async listRooms(): Promise<void> {
    return invoke<void>("server_list_rooms");
  }

  async listPlayers(): Promise<void> {
    return invoke<void>("server_list_players");
  }

  async createRoom(params: CreateRoomParams): Promise<void> {
    return invoke<void>("server_create_room", {
      roomName: params.roomName,
      maxPlayers: params.maxPlayers,
      format: params.format,
      hosted: params.hosted ?? false,
      engine: params.engine ?? "Manabrew",
      draftConfig: params.draftConfig ?? null,
      sealedConfig: params.sealedConfig ?? null,
      reconnectTimeoutS: params.reconnectTimeoutS ?? null,
    });
  }

  async joinRoom(params: JoinRoomParams): Promise<void> {
    return invoke<void>("server_join_room", { ...params });
  }

  async leaveRoom(): Promise<void> {
    return invoke<void>("server_leave_room");
  }

  async setReady(params: SetReadyParams): Promise<void> {
    return invoke<void>("server_set_ready", { ...params });
  }

  async setDeckSelection(params: SetDeckSelectionParams): Promise<void> {
    return invoke<void>("server_set_deck_selection", { ...params });
  }

  async setFormat(params: SetFormatParams): Promise<void> {
    return invoke<void>("server_set_format", { ...params });
  }

  async setMaxPlayers(params: SetMaxPlayersParams): Promise<void> {
    return invoke<void>("server_set_max_players", { maxPlayers: params.maxPlayers });
  }

  async startGame(params?: StartServerGameParams): Promise<void> {
    return invoke<void>("server_start_game", { format: params?.format ?? null });
  }

  async endGame(): Promise<void> {
    return invoke<void>("server_end_game");
  }

  async requestResync(): Promise<void> {
    return invoke<void>("server_request_resync");
  }

  async broadcastState(state: Record<string, unknown>): Promise<void> {
    return invoke<void>("server_broadcast_state", { state });
  }

  async sendRoomMessage(message: RoomRelayEnvelope): Promise<void> {
    return invoke<void>("server_send_room_message", { message });
  }

  async spawnAiBot(params: SpawnAiBotParams): Promise<void> {
    return invoke<void>("server_spawn_ai_bot", {
      roomId: params.roomId,
      roomPassword: params.roomPassword ?? null,
      username: params.username,
      deckName: params.deckName,
      deck: params.deck,
      commanderName: params.commanderName,
      agent: params.agent ?? "simple",
    });
  }

  async removeAiBot(username: string): Promise<void> {
    return invoke<void>("server_remove_ai_bot", { username });
  }
}

// ============================================================================
// Tauri Storage API (uses localStorage for now, could use Tauri fs)
// ============================================================================

class TauriStorageApi implements IStorageApi {
  async get<T>(key: string): Promise<T | null> {
    const item = localStorage.getItem(key);
    if (item === null) return null;
    try {
      return JSON.parse(item) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  }

  async keys(): Promise<string[]> {
    return Object.keys(localStorage);
  }
}

// ============================================================================
// Tauri Event Bus
// ============================================================================

class TauriEventBus implements IEventBus {
  private listeners = new Map<string, Set<(payload: unknown) => void>>();
  private unlistenFns = new Map<string, UnlistenFn>();

  on<T>(event: string, handler: (payload: T) => void): () => void {
    // Add to local listener set
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());

      // Set up Tauri listener once per event type
      listen<T>(event, (e) => {
        const handlers = this.listeners.get(event);
        if (handlers) {
          handlers.forEach((h) => h(e.payload));
        }
      }).then((unlisten) => {
        this.unlistenFns.set(event, unlisten);
      });
    }

    const handlers = this.listeners.get(event)!;
    const typedHandler = handler as (payload: unknown) => void;
    handlers.add(typedHandler);

    // Return unsubscribe function
    return () => {
      handlers.delete(typedHandler);
      // If no more handlers, clean up Tauri listener
      if (handlers.size === 0) {
        const unlisten = this.unlistenFns.get(event);
        if (unlisten) {
          unlisten();
          this.unlistenFns.delete(event);
        }
        this.listeners.delete(event);
      }
    };
  }

  emit<T>(event: string, payload: T): void {
    // Local dispatch (Tauri events are backend → frontend, not frontend → frontend)
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((h) => h(payload));
    }
  }
}

// ============================================================================
// Tauri Platform
// ============================================================================

/**
 * Tauri platform implementation.
 * Used for desktop applications (macOS, Windows, Linux).
 */
export class TauriPlatform implements IPlatformApi {
  readonly type = "tauri" as const;
  readonly game: IGameApi;
  readonly server: IServerApi;
  readonly storage: IStorageApi;
  readonly events: IEventBus;

  constructor() {
    this.game = new TauriGameApi();
    this.server = new TauriServerApi();
    this.storage = new TauriStorageApi();
    this.events = new TauriEventBus();
  }

  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    return invoke<T>(command, args);
  }

  isSupported(feature: PlatformFeature): boolean {
    switch (feature) {
      case "multiplayer":
        return true; // WebSocket server support
      case "native-dialogs":
        return true; // Tauri dialog plugin
      case "system-tray":
        return true; // Tauri tray plugin
      case "auto-update":
        return true; // Tauri updater
      case "offline-play":
        return true; // Full local engine
      default:
        return false;
    }
  }
}
