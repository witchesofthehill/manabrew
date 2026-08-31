/**
 * A seat's direct channel to the room's engine host.
 *
 * Mirrors `manabot`'s `direct.rs`: the relay socket keeps carrying the whole
 * control plane, and only this seat's own engine envelopes move. Both ends
 * freeze on `GameStarted`, the same relay message, which is how host and seat
 * agree on a transport for a game without negotiating.
 *
 * The wasm module behind this is loaded on demand. iroh is about 1.2MB gzipped
 * and most games never offer a direct transport, so a player who does not need
 * it never downloads it.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getPlatform } from "@/platform";
import type { StateEnvelope } from "@/types/server";

/** The slice of `manabrew-net-wasm` this uses. Named here rather than taken
 *  from the generated `.d.ts` so this file reads on its own; the import is a
 *  plain one so the bundler code-splits it into a chunk nobody fetches until a
 *  room offers a direct transport. */
interface NetModule {
  default: (input?: unknown) => Promise<unknown>;
  WasmSeat: {
    bindSeat(username: string, relayUrl: string | null): Promise<WasmSeat>;
  };
}

interface WasmSeat {
  localEndpoint(): Promise<unknown>;
  endpointId(): string;
  connectToHost(roomId: string, topicSecret: string, members: unknown): Promise<unknown>;
  send(envelope: unknown): boolean;
  recv(): Promise<unknown>;
  isConnected(): boolean;
}

export interface DirectTransportStatus {
  kind: string;
  lan: boolean;
  rttMs?: number;
}

/**
 * One way of being a seat. The desktop binds a native endpoint through Tauri
 * and can reach a host directly; the browser has iroh compiled without its IP
 * transports and goes through a relay. Same seat either way as far as anything
 * above here is concerned.
 */
interface SeatBackend {
  start(username: string, relayUrl: string | null): Promise<unknown | null>;
  roster(
    roomId: string,
    topicSecret: string,
    members: unknown,
  ): Promise<DirectTransportStatus | null>;
  send(envelope: unknown): boolean | Promise<boolean>;
  connected(): boolean;
}

/** The desktop's endpoint lives in the shell, so envelopes arrive as events
 *  rather than from a polled channel. */
class TauriSeatBackend implements SeatBackend {
  private live = false;
  private unlisten: (() => void) | null = null;
  private readonly deliver: (envelope: StateEnvelope) => void;

  constructor(deliver: (envelope: StateEnvelope) => void) {
    this.deliver = deliver;
  }

  async start(username: string, relayUrl: string | null): Promise<unknown | null> {
    const binding = await invoke<{ endpoint: unknown }>("direct_seat_start", {
      username,
      relayUrl,
    });
    this.unlisten = await listen<StateEnvelope | null>("direct-seat:envelope", (event) => {
      if (event.payload === null) {
        this.live = false;
        return;
      }
      this.deliver(event.payload);
    });
    return binding.endpoint;
  }

  async roster(
    roomId: string,
    topicSecret: string,
    members: unknown,
  ): Promise<DirectTransportStatus | null> {
    const status = await invoke<DirectTransportStatus | null>("direct_seat_roster", {
      roomId,
      topicSecret,
      members,
    });
    if (status) this.live = true;
    return status;
  }

  async send(envelope: unknown): Promise<boolean> {
    if (!this.live) return false;
    const sent = await invoke<boolean>("direct_seat_send", { envelope });
    if (!sent) this.live = false;
    return sent;
  }

  connected(): boolean {
    return this.live;
  }

  stop(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.live = false;
    void invoke("direct_seat_stop").catch(() => {});
  }
}

/** Only a seat's own answers move; a browser hosting a room still serves its
 *  seats over the relay, which is a later phase. */
function isSeatEnvelope(state: Record<string, unknown>): boolean {
  const kind = (state as Partial<StateEnvelope>).kind;
  return kind === "response" || kind === "directive";
}

/** The wasm module, for a browser. Relay-only by construction. */
class WasmSeatBackend implements SeatBackend {
  private module: NetModule | null = null;
  private seat: WasmSeat | null = null;
  private reading = false;
  private readonly deliver: (envelope: StateEnvelope) => void;

  constructor(deliver: (envelope: StateEnvelope) => void) {
    this.deliver = deliver;
  }

  async start(username: string, relayUrl: string | null): Promise<unknown | null> {
    this.module = (await import("@/wasm-net/net")) as unknown as NetModule;
    await this.module.default();
    this.seat = await this.module.WasmSeat.bindSeat(username, relayUrl);
    return await this.seat.localEndpoint();
  }

  async roster(
    roomId: string,
    topicSecret: string,
    members: unknown,
  ): Promise<DirectTransportStatus | null> {
    if (!this.seat) return null;
    const status = (await this.seat.connectToHost(
      roomId,
      topicSecret,
      members,
    )) as DirectTransportStatus | null;
    if (status) this.startReading();
    return status;
  }

  send(envelope: unknown): boolean {
    return this.seat?.send(envelope) ?? false;
  }

  connected(): boolean {
    return this.seat?.isConnected() ?? false;
  }

  private startReading(): void {
    if (this.reading) return;
    this.reading = true;
    void (async () => {
      while (this.seat) {
        let envelope: unknown;
        try {
          envelope = await this.seat.recv();
        } catch {
          break;
        }
        if (envelope === null || envelope === undefined) break;
        this.deliver(envelope as StateEnvelope);
      }
      this.reading = false;
    })();
  }
}

export class DirectSeat {
  private readonly username: string;
  private readonly relayUrl: string | null;
  private readonly deliver: (envelope: StateEnvelope, fromPlayer: string) => void;
  private backend: SeatBackend | null = null;
  private announced = false;
  private active = false;

  constructor(
    username: string,
    relayUrl: string | null,
    deliver: (envelope: StateEnvelope, fromPlayer: string) => void,
  ) {
    this.username = username;
    this.relayUrl = relayUrl;
    this.deliver = deliver;
  }

  /** The endpoint to announce, once. Null when no backend can start, which
   *  leaves this seat on the relay with nothing else changed. */
  async announce(): Promise<unknown | null> {
    if (this.announced) return null;
    this.announced = true;
    // Indistinguishable from the caller's side. The desktop reaches a host
    // directly; the browser reaches it through a relay; both end up carrying
    // the same envelopes.
    const receive = (envelope: StateEnvelope) => this.deliver(envelope, "");
    const backend =
      getPlatform().type === "tauri" ? new TauriSeatBackend(receive) : new WasmSeatBackend(receive);
    try {
      const endpoint = await backend.start(this.username, this.relayUrl);
      this.backend = backend;
      return endpoint;
    } catch (error) {
      console.warn("[direct] no direct data plane on this build:", error);
      return null;
    }
  }

  /** Installs the relay's roster and dials the host it names. */
  async onRoster(roomId: string, topicSecret: string, members: unknown): Promise<void> {
    if (!this.backend) return;
    try {
      const status = await this.backend.roster(roomId, topicSecret, members);
      if (status) {
        console.info(
          `[direct] seat reached the host over ${status.kind}` +
            (status.lan ? " on the local network" : "") +
            (status.rttMs === undefined ? "" : ` (rtt ${status.rttMs}ms)`),
        );
      }
    } catch (error) {
      console.warn("[direct] could not reach the host:", error);
    }
  }

  freeze(): void {
    this.active = this.backend?.connected() ?? false;
    if (this.active) console.info("[direct] playing this game on the direct plane");
  }

  clear(): void {
    this.active = false;
  }

  /** True when this envelope has been taken; false means send it over the
   *  relay. The desktop's send crosses into the shell, so the answer arrives
   *  after the fact and a failure there falls back on the next envelope. */
  trySend(state: Record<string, unknown>): boolean {
    if (!this.active || !this.backend || !isSeatEnvelope(state)) return false;
    const sent = this.backend.send(state);
    if (typeof sent === "boolean") return sent;
    void sent.then((ok) => {
      if (!ok) this.active = false;
    });
    return true;
  }
}
