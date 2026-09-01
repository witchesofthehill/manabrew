/**
 * A seat's direct channel to the room's engine host.
 *
 * Desktop only. The endpoint is native, in the Tauri shell, because a browser
 * build of iroh has no IP transports and could only ever be relayed; a browser
 * room wants WebRTC instead (#838). On the web this class binds nothing and
 * every seat stays on the relay, which is what it does today.
 *
 * Both ends freeze on `GameStarted`, the same relay message, which is how host
 * and seat agree on a transport for a game without negotiating.
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
  private unlisten: (() => void) | null = null;
  private live = false;
  private active = false;
  /** The in-flight bind, so two `RoomTransport` messages arriving together
   *  cannot both get past a check that sits before an await and each build a
   *  seat. The second would install a second event listener and every host
   *  envelope would arrive twice. */
  private binding: Promise<unknown | null> | null = null;
  private installedRelay: string | null = null;

  constructor(
    username: string,
    relayUrl: string | null,
    deliver: (envelope: StateEnvelope, fromPlayer: string) => void,
  ) {
    this.username = username;
    this.relayUrl = relayUrl;
    this.deliver = deliver;
  }

  /** The endpoint to announce, once. Null when nothing can bind, which leaves
   *  this seat on the relay with nothing else changed. */
  async announce(): Promise<unknown | null> {
    if (this.binding) return null;
    this.binding = this.bind();
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

  /** Installs the relay's roster and dials the host it names. */
  async onRoster(roomId: string, members: unknown): Promise<void> {
    await this.binding;
    if (!this.unlisten) return;
    try {
      const status = await invoke<DirectTransportStatus | null>("direct_seat_roster", {
        roomId,
        members,
      });
      if (!status) return;
      this.live = true;
      console.info(
        `[direct] seat reached the host over ${status.kind}` +
          (status.lan ? " on the local network" : "") +
          (status.rttMs === undefined ? "" : ` (rtt ${status.rttMs}ms)`),
      );
    } catch (error) {
      console.warn("[direct] could not reach the host:", error);
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
