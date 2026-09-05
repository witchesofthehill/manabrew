/**
 * A seat's direct channel to the room's engine host. Desktop only: the endpoint
 * is native in the Tauri shell, because a browser build of iroh has no IP
 * transports. On the web this binds nothing. Both ends freeze on `GameStarted`.
 * See docs/TRANSPORT.md.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getPlatform } from "@/platform";
import type { StateEnvelope } from "@/types/server";

/** Envelopes from the host arrive on this event, carrying exactly what the
 *  relay would have put in `StateUpdate.state`. A null payload says the
 *  channel is gone. */
const ENVELOPE_EVENT = "direct-seat:envelope";

export interface DirectTransportStatus {
  kind: string;
  lan: boolean;
  rttMs?: number;
  setupMs?: number;
  reconnects?: number;
}

/** One attempt on this plane, mirroring the browser plane's report. iroh needs
 *  no probe: QUIC already has the round trip, the path kind and whether the
 *  address is private. */
export interface DirectSeatMeasurement {
  peer: string;
  outcome: "connected" | "failed";
  rttMs?: number;
  connectMs?: number;
  /** iroh's own vocabulary, not ICE's: the relay buckets both. */
  path?: "direct-lan" | "direct-wan" | "relayed";
}

/** iroh's three facts, in iroh's own words. Inventing ICE candidate types for
 *  a QUIC path would read as a measurement of something that never happened. */
function pathOf(status: DirectTransportStatus): DirectSeatMeasurement["path"] {
  if (status.kind === "iroh-relayed") return "relayed";
  return status.lan ? "direct-lan" : "direct-wan";
}

/** Only a seat's own answers move. A host serves its seats from the shell's
 *  own endpoint, not from here. */
function isSeatEnvelope(state: Record<string, unknown>): boolean {
  const kind = (state as Partial<StateEnvelope>).kind;
  return kind === "response" || kind === "directive";
}

export class DirectSeat {
  private readonly username: string;
  private readonly relayUrl: string | null;
  private readonly deliver: (envelope: StateEnvelope, fromPlayer: string) => void;
  private readonly onMeasurement: ((m: DirectSeatMeasurement) => void) | undefined;
  private unlisten: (() => void) | null = null;
  private live = false;
  private active = false;
  /** The in-flight bind, so two rosters arriving together do not each build a
   *  seat and double every host envelope. */
  private binding: Promise<unknown | null> | null = null;
  private installedRelay: string | null = null;

  constructor(
    username: string,
    relayUrl: string | null,
    deliver: (envelope: StateEnvelope, fromPlayer: string) => void,
    onMeasurement?: (m: DirectSeatMeasurement) => void,
  ) {
    this.username = username;
    this.relayUrl = relayUrl;
    this.deliver = deliver;
    this.onMeasurement = onMeasurement;
  }

  /** The endpoint to announce. Bound once; a second call answers with the
   *  same endpoint, which is what a second room needs. Null when nothing can
   *  bind, which leaves this seat on the relay with nothing else changed. */
  async announce(): Promise<unknown | null> {
    if (!this.binding) this.binding = this.bind();
    return this.binding;
  }

  private async bind(): Promise<unknown | null> {
    if (getPlatform().type !== "tauri") return null;
    try {
      const binding = await invoke<{ endpoint: unknown }>("direct_seat_start", {
        username: this.username,
        relayUrl: this.relayUrl,
      });
      this.unlisten = await listen<StateEnvelope | null>(ENVELOPE_EVENT, (event) => {
        if (event.payload === null) {
          this.live = false;
          this.active = false;
          return;
        }
        this.deliver(event.payload, "");
      });
      this.installedRelay = this.relayUrl;
      return binding.endpoint;
    } catch (error) {
      console.warn("[direct] no direct data plane on this build:", error);
      return null;
    }
  }

  /** Adds a relay the control plane named after this seat bound. Skipped when
   *  nothing changed: replacing the relay config schedules a full network
   *  re-probe, and the relay re-broadcasts on every join and leave. */
  async adoptRelay(relayUrl: string): Promise<void> {
    await this.binding;
    if (!this.unlisten || relayUrl === this.installedRelay) return;
    try {
      await invoke("direct_seat_adopt_relay", { relayUrl });
      this.installedRelay = relayUrl;
    } catch (error) {
      console.warn("[direct] could not adopt the relay:", error);
    }
  }

  /** Installs the relay's roster and dials the host it names. A roster with
   *  no host (`null`) is the relay withdrawing the plane, because a player at
   *  the table has not opted in; the shell hangs up whatever was dialled. */
  async onRoster(roomId: string, members: unknown, host: string | null): Promise<void> {
    await this.binding;
    if (!this.unlisten) return;
    try {
      const status = await invoke<DirectTransportStatus | null>("direct_seat_roster", {
        roomId,
        members,
      });
      if (!status) {
        const wasLive = this.live;
        this.live = false;
        this.active = false;
        // No path to the host. This seat stays on the relay, and until now that
        // was the end of it: the attempt reached nobody, so the failures never
        // appeared in any denominator. A hang-up is not an attempt.
        if (host && !wasLive) this.measured({ peer: host, outcome: "failed" });
        return;
      }
      // Rosters repeat on every join and leave; the connection is the same one.
      if (this.live || !host) return;
      this.live = true;
      console.info(
        `[direct] seat reached the host over ${status.kind}` +
          (status.lan ? " on the local network" : "") +
          (status.rttMs === undefined ? "" : ` (rtt ${status.rttMs}ms)`),
      );
      this.measured({
        peer: host,
        outcome: "connected",
        rttMs: status.rttMs,
        connectMs: status.setupMs,
        path: pathOf(status),
      });
    } catch (error) {
      console.warn("[direct] could not reach the host:", error);
      if (host) this.measured({ peer: host, outcome: "failed" });
    }
  }

  private measured(m: DirectSeatMeasurement): void {
    try {
      this.onMeasurement?.(m);
    } catch {
      // Measurement must never take a seat down with it.
    }
  }

  freeze(): void {
    this.active = this.live;
    if (this.active) console.info("[direct] playing this game on the direct plane");
  }

  clear(): void {
    this.active = false;
  }

  /**
   * Takes this envelope, or says it did not. Awaited, not raced: the send
   * crosses into the shell, so the answer only arrives after the fact.
   * Claiming an envelope the shell then failed to send would drop it, and the
   * one most likely to be lost is a prompt response, which leaves the game
   * waiting on that seat until a resync.
   */
  async trySend(state: Record<string, unknown>): Promise<boolean> {
    if (!this.active || !isSeatEnvelope(state)) return false;
    try {
      const sent = await invoke<boolean>("direct_seat_send", { envelope: state });
      if (!sent) this.active = false;
      return sent;
    } catch {
      this.active = false;
      return false;
    }
  }

  stop(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.live = false;
    this.active = false;
    void invoke("direct_seat_stop").catch(() => {});
  }
}
