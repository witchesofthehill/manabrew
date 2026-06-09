/**
 * Web platform implementation.
 *
 * This provides the backend for pure web deployments using WASM.
 * The game engine runs in a Web Worker for non-blocking UI.
 */

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
import { SERVER_ERROR_CODE } from "@/types/server";
import type { RoomRelayEnvelope, StateEnvelope } from "@/types/server";
import type { Prompt, PromptOutput } from "@/protocol";
import type { Deck } from "@/types/manabrew";
import { expandPresetDeckDefinitions, type PresetDeckDefinition } from "@/lib/presetDecks";

// ============================================================================
// Worker Message Types
// ============================================================================

interface WorkerCommand {
  type: "command";
  requestId: string;
  command: string;
  args?: Record<string, unknown>;
}

interface WorkerResponse {
  type: "response";
  requestId: string;
  payload?: unknown;
  error?: string;
}

interface WorkerEvent {
  type: "event";
  event: string;
  payload: unknown;
}

type WorkerMessage = WorkerResponse | WorkerEvent;

interface RemoteSeat {
  buffer: SharedArrayBuffer;
  signal: Int32Array;
  data: Uint8Array;
  /** terminate() flips this so an already-queued rAF poll short-circuits. */
  cancelled: boolean;
}

// A kind-tagged engine message read off a seat's SAB, awaiting relay.
type RelayMessage = {
  forPlayer: string;
  msg: { kind: string; state?: unknown; event?: unknown; prompt?: unknown };
};

// ============================================================================
// Worker Bridge
// ============================================================================

/**
 * Bridge for communicating with the game engine worker.
 */
class WorkerBridge {
  private worker: Worker | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private eventBus: WebEventBus;
  private initPromise: Promise<void> | null = null;

  /** SharedArrayBuffer for local player prompt/response */
  gameBuffer: SharedArrayBuffer | null = null;
  private gameSignal: Int32Array | null = null;
  private gameData: Uint8Array | null = null;

  /** Per-remote-seat SAB state. Keyed by player slot (`player-N`). */
  private remoteSeats = new Map<string, RemoteSeat>();

  constructor(eventBus: WebEventBus) {
    this.eventBus = eventBus;

    // Listen for SAB from worker and start polling for prompts
    eventBus.on<{ buffer: SharedArrayBuffer }>("game:sab", (payload) => {
      this.gameBuffer = payload.buffer;
      this.gameSignal = new Int32Array(this.gameBuffer, 0, 2);
      this.gameData = new Uint8Array(this.gameBuffer, 8);
      console.log("[WorkerBridge] Received local SAB, starting prompt poll");
      this.pollForPrompts();
    });

    // One SAB per non-host seat, tagged with its player slot; one poll
    // loop each, plus the shared response listener installed below.
    eventBus.on<{ buffer: SharedArrayBuffer; playerSlot: string }>("game:remote_sab", (payload) => {
      const seat: RemoteSeat = {
        buffer: payload.buffer,
        signal: new Int32Array(payload.buffer, 0, 2),
        data: new Uint8Array(payload.buffer, 8),
        cancelled: false,
      };
      this.remoteSeats.set(payload.playerSlot, seat);
      console.log(
        `[WorkerBridge] Received remote SAB for ${payload.playerSlot}, starting relay poll`,
      );
      this.pollForRemotePromptsSeat(payload.playerSlot, seat);
    });

    // Eager so a response can't arrive before the listener exists; it
    // no-ops while remoteSeats is empty.
    this.installRemoteResponseListener();
  }

  /**
   * Poll the SAB for prompts from the game engine (runs on main thread).
   * When the engine writes a prompt (signal=1), read it and emit as event.
   */
  private pollForPrompts(): void {
    if (!this.gameSignal || !this.gameData) return;

    // Signal protocol:
    // 0 = IDLE, 1 = PROMPT_READY, 2 = RESPONSE_READY, 3 = PROMPT_ACKNOWLEDGED
    const poll = () => {
      if (!this.gameSignal || !this.gameData || !this.gameBuffer) return;

      const current = Atomics.load(this.gameSignal, 0);
      if (current === 1) {
        // SIGNAL_PROMPT_READY
        const len = Atomics.load(this.gameSignal, 1);
        const jsonBytes = this.gameData.slice(0, len);
        const jsonStr = new TextDecoder().decode(jsonBytes);

        // Acknowledge the prompt so we don't re-read it
        Atomics.store(this.gameSignal, 0, 3); // PROMPT_ACKNOWLEDGED
        Atomics.notify(this.gameSignal, 0);

        try {
          this.dispatchEngineMessage(JSON.parse(jsonStr));
        } catch (e) {
          console.error("[WorkerBridge] Failed to parse SAB message:", e);
        }
      }

      // Keep polling while game is active
      if (this.gameBuffer) {
        requestAnimationFrame(poll);
      }
    };

    requestAnimationFrame(poll);
  }

  private dispatchEngineMessage(msg: {
    kind?: string;
    state?: unknown;
    event?: unknown;
    prompt?: unknown;
  }): void {
    switch (msg?.kind) {
      case "state":
        this.eventBus.emit("game:state", msg.state);
        break;
      case "display":
        this.eventBus.emit("game:display", msg.event);
        break;
      case "prompt":
        this.eventBus.emit("game:prompt", msg.prompt);
        break;
    }
  }

  /** One rAF poll loop per remote seat's SAB; relays messages via the bus. */
  private pollForRemotePromptsSeat(playerSlot: string, seat: RemoteSeat): void {
    const poll = () => {
      if (seat.cancelled || !this.remoteSeats.has(playerSlot)) return;

      const current = Atomics.load(seat.signal, 0);
      if (current === 1) {
        const len = Atomics.load(seat.signal, 1);
        const jsonBytes = seat.data.slice(0, len);
        const jsonStr = new TextDecoder().decode(jsonBytes);

        Atomics.store(seat.signal, 0, 3); // ACKNOWLEDGED
        Atomics.notify(seat.signal, 0);

        console.log(`[transport←sab/seat ${playerSlot}] engine emitted:`, jsonStr);
        try {
          const msg = JSON.parse(jsonStr);
          this.eventBus.emit("game:relay_message", { forPlayer: playerSlot, msg });
        } catch (e) {
          console.error(`[WorkerBridge] Failed to parse SAB message for ${playerSlot}:`, e);
        }
      }

      requestAnimationFrame(poll);
    };

    requestAnimationFrame(poll);
  }

  /**
   * Routes each `server:state_update` of kind `response` to the SAB for
   * the seat named in `fromPlayer`. Subscription lives for the page's
   * lifetime (singleton bridge, no disposal), so the unsubscribe is dropped.
   */
  private installRemoteResponseListener(): void {
    this.eventBus.on<{
      from_player: string;
      state: Record<string, unknown>;
    }>("server:state_update", (payload) => {
      if (payload.state?.kind !== "response") return;
      const fromPlayer = payload.state.fromPlayer as string | undefined;
      if (!fromPlayer) return;
      const seat = this.remoteSeats.get(fromPlayer);
      console.log(`[MP] response← ${fromPlayer}`, seat ? "(routed to SAB)" : "(NO SEAT — dropped)");
      if (!seat) return;
      const action = payload.state.action;
      if (!action) return;
      const json = new TextEncoder().encode(JSON.stringify(action));
      Atomics.store(seat.signal, 1, json.length);
      seat.data.set(json, 0);
      Atomics.store(seat.signal, 0, 2); // RESPONSE_READY
      Atomics.notify(seat.signal, 0);
    });
  }

  /**
   * Write a response to the SharedArrayBuffer and wake the worker.
   */
  writeResponse(action: PromptOutput): void {
    if (!this.gameSignal || !this.gameData) {
      console.error("[WorkerBridge] No SharedArrayBuffer available for response");
      return;
    }

    const json = new TextEncoder().encode(JSON.stringify(action));
    // Write length
    Atomics.store(this.gameSignal, 1, json.length);
    // Write data
    this.gameData.set(json, 0);
    // Signal response ready
    Atomics.store(this.gameSignal, 0, 2); // SIGNAL_RESPONSE_READY
    Atomics.notify(this.gameSignal, 0);
  }

  /**
   * Initialize the worker lazily.
   */
  async init(): Promise<void> {
    if (this.worker) return;

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Create worker using Vite's worker import pattern. The worker
        // kicks off `initWasm()` eagerly at module-load time and emits
        // `worker:init { stage: 'ready' | 'error' }` when done — we wait
        // for that event instead of pinging, so init has no command-level
        // timeout to fight.
        this.worker = new Worker(new URL("../workers/game-engine.worker.ts", import.meta.url), {
          type: "module",
        });

        this.worker.onmessage = this.handleMessage.bind(this);
        this.worker.onerror = (e) => {
          console.error("[WorkerBridge] Worker error:", e);
          reject(new Error(`Worker error: ${e.message}`));
        };

        const unsubscribe = this.eventBus.on<{ stage?: string; message?: string }>(
          "worker:init",
          (payload) => {
            if (payload?.stage === "ready") {
              unsubscribe();
              console.log("[WorkerBridge] Worker reported ready");
              resolve();
            } else if (payload?.stage === "error") {
              unsubscribe();
              reject(new Error(payload.message ?? "Worker init failed"));
            }
          },
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  private handleMessage(e: MessageEvent<WorkerMessage>): void {
    const message = e.data;

    if (message.type === "response") {
      const pending = this.pendingRequests.get(message.requestId);
      if (pending) {
        this.pendingRequests.delete(message.requestId);
        if (message.error) {
          pending.reject(new Error(message.error));
        } else {
          pending.resolve(message.payload);
        }
      }
    } else if (message.type === "event") {
      // Forward events to the event bus
      this.eventBus.emit(message.event, message.payload);
    }
  }

  /**
   * Invoke a command on the worker.
   */
  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    await this.init();

    if (!this.worker) {
      throw new Error("Worker not initialized");
    }

    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      const message: WorkerCommand = {
        type: "command",
        requestId,
        command,
        args,
      };

      this.worker!.postMessage(message);

      // start_game blocks for the whole game; everything else is a quick
      // dispatch over a worker that has already finished initialization
      // (we `await this.init()` above, which waits for the ready event).
      const timeout = command === "start_game" ? 3600000 : 30000;
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Command timed out: ${command}`));
        }
      }, timeout);
    });
  }

  /**
   * Terminate the worker.
   */
  terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.gameBuffer = null;
    this.gameSignal = null;
    this.gameData = null;
    for (const seat of this.remoteSeats.values()) seat.cancelled = true;
    this.remoteSeats.clear();
    // Response listener stays installed — terminate() is per-game, and a
    // second game on this (singleton) bridge still needs it.
    this.pendingRequests.clear();
    this.initPromise = null;
  }
}

// ============================================================================
// Web Game API (WASM-based)
// ============================================================================

class WebGameApi implements IGameApi {
  private bridge: WorkerBridge;
  private serverApi: WebServerApi | null = null;
  private isMultiplayer = false;
  private isHost = false;
  private myPlayerSlot: string | null = null;

  constructor(bridge: WorkerBridge) {
    this.bridge = bridge;
  }

  /** Set server API reference for multiplayer relay */
  setServerApi(server: WebServerApi): void {
    this.serverApi = server;
  }

  async startGame(params: StartGameParams): Promise<string> {
    return this.bridge.invoke<string>("start_game", {
      deck: params.deck,
      startingLife: params.startingLife,
      commanderName: params.commanderName,
      opponentDeck: params.opponentDeck,
    });
  }

  async startMultiplayerGame(params: StartMultiplayerGameParams): Promise<void> {
    this.isMultiplayer = true;
    this.isHost = params.localIsHost;
    this.myPlayerSlot = `player-${params.enginePlayerIndex}`;

    if (params.localIsHost) {
      // Host runs the engine; the worker posts back one SAB per remote
      // seat (see the game:remote_sab handler in WorkerBridge).
      await this.bridge.invoke("start_multiplayer_game", {
        decks: params.decks,
        commanderNames: params.commanderNames,
        playerNames: params.playerNames,
        enginePlayerIndex: params.enginePlayerIndex,
        startingLife: params.startingLife,
      });
    }
    // Non-host: prompts arrive via game:remote_prompt WebSocket events.
    // Responses are sent via BroadcastState WebSocket relay.
  }

  async respond(params: RespondParams): Promise<void> {
    if (this.isMultiplayer && !this.isHost && this.serverApi) {
      // Non-host multiplayer: relay response via WebSocket to the host
      const fromPlayer = params.playerSlot ?? this.myPlayerSlot ?? "player-0";
      const envelope: StateEnvelope = {
        kind: "response",
        fromPlayer,
        action: params.action,
      };
      console.log(`[MP] respond→ as ${fromPlayer}:`, params.action.type);
      this.serverApi.broadcastState(envelope);
    } else if (this.bridge.gameBuffer) {
      // Host or single-player: write response to local SharedArrayBuffer
      this.bridge.writeResponse(params.action);
    } else {
      await this.bridge.invoke("respond", {
        action: params.action,
        playerSlot: params.playerSlot,
      });
    }
  }

  async endGame(): Promise<void> {
    this.isMultiplayer = false;
    this.isHost = false;
    this.myPlayerSlot = null;
    if (this.bridge.gameBuffer) {
      this.bridge.terminate();
      return;
    }
    await this.bridge.invoke("end_game");
  }

  async restoreSnapshot(params: RestoreSnapshotParams): Promise<void> {
    await this.bridge.invoke("restore_snapshot", {
      checkpointId: params.checkpointId,
    });
  }

  async getPresetDecks(): Promise<Deck[]> {
    return expandPresetDeckDefinitions(
      await this.bridge.invoke<PresetDeckDefinition[]>("get_preset_decks"),
    );
  }

  async getPrompt(): Promise<Prompt | null> {
    return this.bridge.invoke<Prompt | null>("get_prompt");
  }
}

// ============================================================================
// Web Storage API (localStorage-based, upgradeable to IndexedDB)
// ============================================================================

class WebStorageApi implements IStorageApi {
  private prefix = "manabrew:";

  async get<T>(key: string): Promise<T | null> {
    const item = localStorage.getItem(this.prefix + key);
    if (item === null) return null;
    try {
      return JSON.parse(item) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(this.prefix + key, JSON.stringify(value));
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(this.prefix + key);
  }

  async keys(): Promise<string[]> {
    const allKeys = Object.keys(localStorage);
    return allKeys.filter((k) => k.startsWith(this.prefix)).map((k) => k.slice(this.prefix.length));
  }
}

// ============================================================================
// Web Event Bus (pure JS implementation)
// ============================================================================

class WebEventBus implements IEventBus {
  private listeners = new Map<string, Set<(payload: unknown) => void>>();

  on<T>(event: string, handler: (payload: T) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const handlers = this.listeners.get(event)!;
    const typedHandler = handler as (payload: unknown) => void;
    handlers.add(typedHandler);

    // Return unsubscribe function
    return () => {
      handlers.delete(typedHandler);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  emit<T>(event: string, payload: T): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((h) => h(payload));
    }
  }
}

// ============================================================================
// Web Server API (WebSocket-based multiplayer)
// ============================================================================

interface BotEntry {
  ws: WebSocket;
  /** wasm-bindgen handle — has `free()` to release the underlying memory. */
  bot: {
    on_open(): string[];
    on_server_message(text: string): string[];
    failure(): string | undefined;
    free(): void;
  };
}

const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

class WebServerApi implements IServerApi {
  private ws: WebSocket | null = null;
  private eventBus: WebEventBus;
  private relayUrl: string | null = null;
  private serverPassword: string | null = null;
  private bots = new Map<string, BotEntry>();
  private wasmReady: Promise<typeof import("@/wasm/forge_wasm")> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private connectParams: ServerConnectParams | null = null;
  private connectedAt: number | null = null;
  private manualDisconnect = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private serverShutdownPending: { reconnectInS: number } | null = null;
  // State/Display carry no recipient and are identical per seat; each seat's
  // poll relays a copy, so coalesce consecutive-identical ones to one broadcast.
  private lastRelayState: string | null = null;
  private lastRelayDisplay: string | null = null;

  constructor(eventBus: WebEventBus) {
    this.eventBus = eventBus;

    // Relay engine messages (state/display/prompt) to remote players via WebSocket.
    eventBus.on<RelayMessage>("game:relay_message", ({ forPlayer, msg }) => {
      if (msg.kind === "state") {
        const json = JSON.stringify(msg.state);
        if (json === this.lastRelayState) return;
        this.lastRelayState = json;
        this.broadcastState({ kind: "state", state: msg.state });
      } else if (msg.kind === "display") {
        const json = JSON.stringify(msg.event);
        if (json === this.lastRelayDisplay) return;
        this.lastRelayDisplay = json;
        this.broadcastState({ kind: "display", event: msg.event });
      } else if (msg.kind === "prompt") {
        this.broadcastState({ kind: "prompt", forPlayer, prompt: msg.prompt });
      }
    });
  }

  async connect(params: ServerConnectParams): Promise<void> {
    await this.disconnect();
    this.manualDisconnect = false;
    this.connectParams = params;
    this.reconnectAttempt = 0;
    return this.openSocket(params);
  }

  private openSocket(params: ServerConnectParams): Promise<void> {
    const url = buildServerUrl(params);
    this.relayUrl = url;
    this.serverPassword = params.password;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.connectedAt = Date.now();
        this.send({
          type: "Authenticate",
          username: params.username,
          password: params.password,
        });
        this.startKeepalive();
        resolve();
      };

      this.ws.onerror = () => {
        reject(new Error(`Failed to connect to ${url}`));
      };

      this.ws.onclose = (event) => {
        this.handleSocketClose(event);
      };

      this.ws.onmessage = (e: MessageEvent) => {
        if (typeof e.data !== "string") return;
        try {
          const msg = JSON.parse(e.data);
          this.handleServerMessage(msg);
        } catch {
          // Ignore malformed messages
        }
      };
    });
  }

  private handleSocketClose(event: CloseEvent): void {
    const connectedForS =
      this.connectedAt !== null ? Math.round((Date.now() - this.connectedAt) / 1000) : null;
    const shutdownPending = this.serverShutdownPending;
    console.warn("[relay-disconnect]", {
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
      connected_for_s: connectedForS,
      visibility: typeof document !== "undefined" ? document.visibilityState : "unknown",
      hadServerShutdown: shutdownPending !== null,
    });

    this.stopKeepalive();
    this.ws = null;
    this.connectedAt = null;

    if (this.manualDisconnect) {
      this.eventBus.emit("server:disconnected", { terminal: true });
      return;
    }

    if (this.connectParams === null) {
      this.eventBus.emit("server:disconnected", { terminal: true });
      return;
    }

    if (shutdownPending !== null) {
      this.serverShutdownPending = null;
      this.scheduleReconnect("server-shutdown", shutdownPending.reconnectInS * 1000);
      return;
    }

    this.scheduleReconnect("network", this.nextBackoffMs());
  }

  private nextBackoffMs(): number {
    const idx = Math.min(this.reconnectAttempt, RECONNECT_BACKOFF_MS.length - 1);
    const base = RECONNECT_BACKOFF_MS[idx]!;
    const jitter = base * (Math.random() * 0.4 - 0.2);
    return Math.max(250, Math.round(base + jitter));
  }

  private scheduleReconnect(reason: "network" | "server-shutdown", delayMs: number): void {
    this.clearReconnectTimer();
    this.reconnectAttempt += 1;
    this.eventBus.emit("server:reconnecting", {
      phase: "reconnecting" as const,
      attempt: this.reconnectAttempt,
      delayMs,
      reason,
    });
    this.reconnectTimer = setTimeout(() => {
      void this.tryReconnect();
    }, delayMs);
  }

  private async tryReconnect(): Promise<void> {
    this.reconnectTimer = null;
    const params = this.connectParams;
    if (params === null || this.manualDisconnect) {
      return;
    }
    try {
      await this.openSocket(params);
      this.reconnectAttempt = 0;
      this.eventBus.emit("server:reconnecting", { phase: "idle" as const, attempt: 0 });
    } catch (e) {
      console.warn("[relay-disconnect] reconnect attempt failed", e);
      this.scheduleReconnect("network", this.nextBackoffMs());
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepaliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.send({ type: "Ping" });
    }, 30_000);
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer !== null) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
  }

  async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    this.clearReconnectTimer();
    this.serverShutdownPending = null;
    this.reconnectAttempt = 0;
    this.connectParams = null;
    this.stopKeepalive();
    for (const username of [...this.bots.keys()]) {
      await this.removeAiBot(username);
    }
    const ws = this.ws;
    this.ws = null;
    this.relayUrl = null;
    this.serverPassword = null;
    this.connectedAt = null;
    if (!ws || ws.readyState === WebSocket.CLOSED) return;
    // Wait for the actual close event before resolving. Resolving on
    // ws.close() alone races against the server still cleaning up the
    // session, so Settings "Save & Reconnect" (disconnect → connect)
    // would race the new authenticate against the previous session and
    // forge-server rejected it as a duplicate.
    await new Promise<void>((resolve) => {
      const done = () => {
        ws.removeEventListener("close", done);
        ws.removeEventListener("error", done);
        resolve();
      };
      ws.addEventListener("close", done);
      ws.addEventListener("error", done);
      ws.close();
    });
  }

  async listRooms(): Promise<void> {
    this.send({ type: "ListRooms" });
  }

  async listPlayers(): Promise<void> {
    this.send({ type: "ListPlayers" });
  }

  async createRoom(params: CreateRoomParams): Promise<void> {
    this.send({
      type: "CreateRoom",
      room_name: params.roomName,
      max_players: params.maxPlayers,
      format: params.format,
      hosted: params.hosted ?? false,
      engine: params.engine ?? "Wasm",
      draft_config: params.draftConfig ?? null,
      sealed_config: params.sealedConfig ?? null,
    });
  }

  async joinRoom(params: JoinRoomParams): Promise<void> {
    this.send({
      type: "JoinRoom",
      room_id: params.roomId,
      observe: params.observe ?? false,
      password: params.password ?? null,
    });
  }

  async leaveRoom(): Promise<void> {
    this.send({ type: "LeaveRoom" });
  }

  async setReady(params: SetReadyParams): Promise<void> {
    this.send({ type: "SetReady", ready: params.ready });
  }

  async setDeckSelection(params: SetDeckSelectionParams): Promise<void> {
    this.send({
      type: "SetDeckSelection",
      deck_name: params.deckName,
      deck: params.deck,
      commander_name: params.commanderName,
    });
  }

  async setFormat(params: SetFormatParams): Promise<void> {
    this.send({ type: "SetFormat", format: params.format });
  }

  async setMaxPlayers(params: SetMaxPlayersParams): Promise<void> {
    this.send({ type: "SetMaxPlayers", max_players: params.maxPlayers });
  }

  async startGame(params?: StartServerGameParams): Promise<void> {
    this.send({ type: "StartGame", format: params?.format ?? null });
  }

  async endGame(): Promise<void> {
    this.send({ type: "EndGame" });
  }

  /** Broadcast game state to other players in the room */
  async broadcastState(state: Record<string, unknown>): Promise<void> {
    this.send({ type: "BroadcastState", state });
  }

  async sendRoomMessage(message: RoomRelayEnvelope): Promise<void> {
    this.send({ type: "BroadcastState", state: message });
  }

  async spawnAiBot(params: SpawnAiBotParams): Promise<void> {
    if (!this.relayUrl || this.serverPassword == null) {
      throw new Error("Cannot spawn bot: not connected to relay.");
    }
    if (this.bots.has(params.username)) {
      throw new Error(`Bot '${params.username}' is already running.`);
    }
    const wasm = await this.loadWasm();
    const bot = new wasm.WasmBot(
      JSON.stringify({
        username: params.username,
        password: this.serverPassword,
        roomId: params.roomId,
        deckName: params.deckName,
        deck: params.deck,
        commanderName: params.commanderName,
        agent: params.agent ?? "simple",
      }),
    );
    const ws = new WebSocket(this.relayUrl);
    const entry: BotEntry = { ws, bot };
    this.bots.set(params.username, entry);
    ws.onopen = () => {
      for (const msg of bot.on_open()) ws.send(msg);
    };
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data !== "string") return;
      for (const msg of bot.on_server_message(e.data)) ws.send(msg);
      const failure = bot.failure();
      if (failure) {
        console.error(`[bot ${params.username}] ${failure}`);
        ws.close();
      }
    };
    ws.onerror = () => console.error(`[bot ${params.username}] WebSocket error`);
    ws.onclose = () => {
      bot.free();
      this.bots.delete(params.username);
    };
  }

  async removeAiBot(username: string): Promise<void> {
    const entry = this.bots.get(username);
    if (!entry) return;
    entry.ws.close();
    this.bots.delete(username);
    // `bot.free()` is invoked from the ws.onclose handler — calling it here too
    // would double-free the wasm-bindgen handle.
  }

  private async loadWasm(): Promise<typeof import("@/wasm/forge_wasm")> {
    if (!this.wasmReady) {
      this.wasmReady = (async () => {
        const wasm = await import("@/wasm/forge_wasm");
        await wasm.default();
        return wasm;
      })();
    }
    return this.wasmReady;
  }

  private send(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error("[WebServerApi] Not connected");
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }

  private handleServerMessage(msg: Record<string, unknown>): void {
    console.log("[transport←ws] received:", JSON.stringify(msg));
    const type = msg.type as string;

    if (type === "ServerShuttingDown") {
      const reconnectInS = typeof msg.reconnect_in_s === "number" ? msg.reconnect_in_s : 5;
      this.serverShutdownPending = { reconnectInS };
      this.eventBus.emit("server:reconnecting", {
        phase: "reconnecting" as const,
        attempt: this.reconnectAttempt + 1,
        delayMs: reconnectInS * 1000,
        reason: "server-shutdown" as const,
      });
      return;
    }

    if (type === "StateUpdate" && msg.state) {
      const envelope = msg.state as StateEnvelope;
      switch (envelope.kind) {
        case "response":
          this.eventBus.emit("server:state_update", {
            from_player: msg.from_player,
            state: envelope,
          });
          return;
        case "roomRelay":
          this.eventBus.emit("server:room_message", {
            from_player: msg.from_player,
            state: envelope,
          });
          break;
        case "state":
          this.eventBus.emit("game:remote_state", envelope);
          return;
        case "display":
          this.eventBus.emit("game:remote_display", envelope);
          return;
        case "prompt":
          this.eventBus.emit("game:remote_prompt", envelope);
          return;
        case "log":
          this.eventBus.emit("game:log", envelope.entry);
          return;
        case "snapshot":
          this.eventBus.emit("game:snapshot", envelope.entry);
          return;
      }
    }

    if (type === "Error" && msg.code === SERVER_ERROR_CODE.NotInRoom) {
      this.eventBus.emit("game:forced_end", {
        reason: SERVER_ERROR_CODE.NotInRoom,
        message: msg.message,
      });
    }

    // Map server message type to event name and payload
    const eventMap: Record<string, [string, unknown]> = {
      AuthResult: [
        "server:auth_result",
        {
          success: msg.success,
          player_id: msg.player_id,
          reconnected: msg.reconnected,
          error: msg.error,
        },
      ],
      RoomList: ["server:room_list", { rooms: msg.rooms }],
      PlayerList: ["server:player_list", { players: msg.players }],
      RoomCreated: ["server:room_created", { room_id: msg.room_id, room_name: msg.room_name }],
      PlayerJoined: ["server:player_joined", { room_id: msg.room_id, username: msg.username }],
      PlayerLeft: ["server:player_left", { room_id: msg.room_id, username: msg.username }],
      PlayerConnected: ["server:player_connected", { username: msg.username }],
      PlayerDisconnected: ["server:player_disconnected", { username: msg.username }],
      ReadyStateChanged: ["server:ready_changed", { username: msg.username, ready: msg.ready }],
      RoomUpdate: ["server:room_update", { room: msg.room }],
      GameStarted: [
        "server:game_started",
        {
          room_id: msg.room_id,
          player_order: msg.player_order,
          player_decks: msg.player_decks,
          starting_life: msg.starting_life,
        },
      ],
      StateUpdate: ["server:state_update", { from_player: msg.from_player, state: msg.state }],
      TurnChanged: [
        "server:turn_changed",
        {
          from_player: msg.from_player,
          new_active_player: msg.new_active_player,
          turn_number: msg.turn_number,
        },
      ],
      Error: ["server:error", { code: msg.code, message: msg.message }],
    };

    const mapping = eventMap[type];
    if (mapping) {
      this.eventBus.emit(mapping[0], mapping[1]);
    }
  }
}

function buildServerUrl(params: ServerConnectParams): string {
  if (/^wss?:\/\//i.test(params.host)) {
    return params.host;
  }
  const scheme = params.port === 443 ? "wss" : "ws";
  return `${scheme}://${params.host}:${params.port}`;
}

// ============================================================================
// Web Platform
// ============================================================================

/**
 * Web platform implementation.
 * Used for browser-based deployments with WASM game engine.
 *
 * The game engine runs in a dedicated Web Worker to keep the UI responsive.
 * Communication happens via postMessage with a request/response protocol.
 */
export class WebPlatform implements IPlatformApi {
  readonly type = "web" as const;
  readonly game: IGameApi;
  readonly storage: IStorageApi;
  readonly events: WebEventBus;
  readonly server: IServerApi;

  private bridge: WorkerBridge;

  constructor() {
    this.events = new WebEventBus();
    this.storage = new WebStorageApi();
    this.bridge = new WorkerBridge(this.events);
    const serverApi = new WebServerApi(this.events);
    const gameApi = new WebGameApi(this.bridge);
    gameApi.setServerApi(serverApi);
    this.game = gameApi;
    this.server = serverApi;
  }

  /**
   * Initialize the platform (and worker) eagerly.
   * Call this at app startup for faster first game start.
   */
  async init(): Promise<void> {
    await this.bridge.init();
  }

  async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    return this.bridge.invoke<T>(command, args);
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    this.bridge.terminate();
  }

  isSupported(feature: PlatformFeature): boolean {
    switch (feature) {
      case "multiplayer":
        return true; // WebSocket-based multiplayer via forge-server
      case "native-dialogs":
        return false; // Browser has limited file system access
      case "system-tray":
        return false; // Not applicable to web
      case "auto-update":
        return false; // Web is always "updated" via cache
      case "offline-play":
        return false; // Browser path still depends on remote assets and no service worker exists
      default:
        return false;
    }
  }
}
