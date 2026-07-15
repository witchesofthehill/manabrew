/**
 * Tauri platform implementation.
 *
 */

import { invoke } from "@tauri-apps/api/core";
import { WebPlatform } from "./web";

import type {
  IPlatformApi,
  IGameApi,
  IServerApi,
  IStorageApi,
  IEventBus,
  PlatformFeature,
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
// Tauri Server API — delegates to the web relay client, except Forge hosting
// ============================================================================

class TauriServerApi implements IServerApi {
  private connection: ServerConnectParams | null = null;
  private readonly inner: IServerApi;

  constructor(inner: IServerApi) {
    this.inner = inner;
  }

  async connect(params: ServerConnectParams): Promise<void> {
    this.connection = params;
    return this.inner.connect(params);
  }

  async disconnect(): Promise<void> {
    this.connection = null;
    return this.inner.disconnect();
  }

  async createRoom(params: CreateRoomParams): Promise<string | null> {
    if (params.engine === "Forge") {
      if (!this.connection) {
        throw new Error("Connect to a server before hosting a Forge room");
      }
      return invoke<string>("start_forge_host", {
        host: this.connection.host,
        port: this.connection.port,
        relayPassword: this.connection.password,
        roomName: params.roomName,
        format: params.format,
        maxPlayers: params.maxPlayers,
        password: params.password ?? null,
      });
    }
    return this.inner.createRoom(params);
  }

  async stopRoom(): Promise<void> {
    await invoke("stop_forge_host");
    return this.inner.stopRoom();
  }

  listRooms(): Promise<void> {
    return this.inner.listRooms();
  }
  listPlayers(): Promise<void> {
    return this.inner.listPlayers();
  }
  joinRoom(params: JoinRoomParams): Promise<void> {
    return this.inner.joinRoom(params);
  }
  leaveRoom(): Promise<void> {
    return this.inner.leaveRoom();
  }
  setReady(params: SetReadyParams): Promise<void> {
    return this.inner.setReady(params);
  }
  setDeckSelection(params: SetDeckSelectionParams): Promise<void> {
    return this.inner.setDeckSelection(params);
  }
  setFormat(params: SetFormatParams): Promise<void> {
    return this.inner.setFormat(params);
  }
  setMaxPlayers(params: SetMaxPlayersParams): Promise<void> {
    return this.inner.setMaxPlayers(params);
  }
  startGame(params?: StartServerGameParams): Promise<void> {
    return this.inner.startGame(params);
  }
  endGame(gameId: string): Promise<void> {
    return this.inner.endGame(gameId);
  }
  requestResync(): Promise<void> {
    return this.inner.requestResync();
  }
  broadcastState(state: Record<string, unknown>): Promise<void> {
    return this.inner.broadcastState(state);
  }
  sendRoomMessage(message: RoomRelayEnvelope): Promise<void> {
    return this.inner.sendRoomMessage(message);
  }
  spawnAiBot(params: SpawnAiBotParams): Promise<void> {
    return this.inner.spawnAiBot(params);
  }
  removeAiBot(username: string): Promise<void> {
    return this.inner.removeAiBot(username);
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

  private readonly web: WebPlatform;

  constructor() {
    this.web = new WebPlatform();
    this.game = this.web.game;
    this.storage = this.web.storage;
    this.events = this.web.events;
    this.server = new TauriServerApi(this.web.server);
  }

  async init(): Promise<void> {
    return this.web.init();
  }

  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    return invoke<T>(command, args);
  }

  isSupported(feature: PlatformFeature): boolean {
    switch (feature) {
      case "multiplayer":
        return true;
      case "native-dialogs":
        return true;
      case "system-tray":
        return true;
      case "auto-update":
        return true;
      case "offline-play":
        return true;
      default:
        return false;
    }
  }
}
