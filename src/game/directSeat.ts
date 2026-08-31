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
import type { StateEnvelope } from "@/types/server";

/** The slice of `manabrew-net-wasm` this uses. Named here rather than taken
 *  from the generated `.d.ts` so this file reads on its own; the import is a
 *  plain one so the bundler code-splits it into a chunk nobody fetches until a
 *  room offers a direct transport. */
interface NetModule {
  default: (input?: unknown) => Promise<unknown>;
  WasmSeat: {
    bindSeat(username: string, relayUrl: string): Promise<WasmSeat>;
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

/** Only a seat's own answers move; a browser hosting a room still serves its
 *  seats over the relay, which is a later phase. */
function isSeatEnvelope(state: Record<string, unknown>): boolean {
  const kind = (state as Partial<StateEnvelope>).kind;
  return kind === "response" || kind === "directive";
}

export class DirectSeat {
  private module: NetModule | null = null;
  private seat: WasmSeat | null = null;
  private announced = false;
  private active = false;
  private reading = false;

  private readonly username: string;
  private readonly relayUrl: string;
  private readonly deliver: (envelope: StateEnvelope, fromPlayer: string) => void;

  constructor(
    username: string,
    relayUrl: string,
    deliver: (envelope: StateEnvelope, fromPlayer: string) => void,
  ) {
    this.username = username;
    this.relayUrl = relayUrl;
    this.deliver = deliver;
  }

  /** The endpoint to announce, once. Null when the module cannot load, which
   *  leaves this seat on the relay with nothing else changed. */
  async announce(): Promise<unknown | null> {
    if (this.announced) return null;
    this.announced = true;
    try {
      this.module ??= (await import("@/wasm-net/net")) as unknown as NetModule;
      await this.module.default();
      this.seat = await this.module.WasmSeat.bindSeat(this.username, this.relayUrl);
      return await this.seat.localEndpoint();
    } catch (error) {
      console.warn("[direct] no direct data plane in this build:", error);
      this.seat = null;
      return null;
    }
  }

  /** Installs the relay's roster and dials the host it names. */
  async onRoster(roomId: string, topicSecret: string, members: unknown): Promise<void> {
    if (!this.seat) return;
    try {
      const status = (await this.seat.connectToHost(
        roomId,
        topicSecret,
        members,
      )) as DirectTransportStatus | null;
      if (status) {
        console.info(
          `[direct] seat reached the host over ${status.kind}` +
            (status.lan ? " on the local network" : "") +
            (status.rttMs === undefined ? "" : ` (rtt ${status.rttMs}ms)`),
        );
        this.startReading();
      }
    } catch (error) {
      console.warn("[direct] could not reach the host:", error);
    }
  }

  freeze(): void {
    this.active = this.seat?.isConnected() ?? false;
    if (this.active) console.info("[direct] playing this game on the direct plane");
  }

  clear(): void {
    this.active = false;
  }

  trySend(state: Record<string, unknown>): boolean {
    if (!this.active || !this.seat || !isSeatEnvelope(state)) return false;
    try {
      return this.seat.send(state);
    } catch {
      this.active = false;
      return false;
    }
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
        // Indistinguishable from the same envelope arriving in a StateUpdate,
        // which is the point: nothing above the transport knows the difference.
        this.deliver(envelope as StateEnvelope, "");
      }
      this.reading = false;
      this.active = false;
      console.info("[direct] channel closed; this seat is back on the relay");
    })();
  }
}
