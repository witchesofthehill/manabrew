/**
 * The webview standing in as the WebRTC end of a desktop-hosted room.
 *
 * A desktop host runs its engine in the Tauri shell, on its own relay session
 * (`forge-host-<uuid>`). A browser seat in that room cannot be dialled from
 * there: a browser is reachable over WebRTC and nothing else, and the only
 * thing in the process that can make a WebRTC connection is this webview. So
 * the node hands its envelopes out through the shell and this drives the
 * connections on its behalf. Two thirds of mixed rooms are desktop-hosted
 * (#838).
 *
 * The relay session stays in the node. Signalling addressed to the host
 * arrives there and is forwarded here; what this answers goes back and is sent
 * under the host's own attested identity. This never gets a session it could
 * speak for the host with, which is what keeps that attestation worth
 * anything.
 *
 * The freeze lives in the node too. `ShellBridge` decides at `GameStarted`
 * which seats this plane carries and stops handing over envelopes for the
 * rest; this only reports which channels are open, and delivers.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebRtcPlane, type RosterMember } from "@/game/webrtcPlane";

/** Matches `BRIDGE_EVENT` in src-tauri/src/forge_room.rs. */
const BRIDGE_EVENT = "forge-host:bridge";

type BridgeEvent =
  | { kind: "envelope"; target: string; envelope: Record<string, unknown> }
  | { kind: "signal"; from: string; payload: unknown };

export class ForgeHostBridge {
  /** The node's relay username. The plane runs as this, so it sees itself as
   *  the room's host and every host rule applies unchanged. */
  private readonly hostUsername: string;
  private plane: WebRtcPlane | null = null;
  private unlisten: (() => void) | null = null;
  /** The in-flight start, so two rosters arriving together cannot each install
   *  a listener and deliver every envelope twice. */
  private starting: Promise<void> | null = null;
  private lastServing = "";

  constructor(hostUsername: string) {
    this.hostUsername = hostUsername;
  }

  /** Whether this app is the one running a Forge room's engine host. False on
   *  the web, and on a desktop that merely joined somebody else's room. */
  static async hosting(): Promise<boolean> {
    return invoke<boolean>("forge_room_running").catch(() => false);
  }

  async start(): Promise<void> {
    if (!this.starting) this.starting = this.begin();
    return this.starting;
  }

  private async begin(): Promise<void> {
    this.plane = new WebRtcPlane({
      username: this.hostUsername,
      signal: (to, payload) => {
        void invoke("forge_host_signal", { to, payload }).catch((error) =>
          console.warn("[forge-host] could not send signalling:", error),
        );
      },
      deliver: (envelope, fromPlayer) => {
        // Straight into the engine, the same route a relay `StateUpdate`
        // takes. The name is one the relay attested in the roster.
        void invoke("forge_host_seat_envelope", { from: fromPlayer, envelope }).catch((error) =>
          console.warn("[forge-host] could not deliver a seat envelope:", error),
        );
      },
      onServing: (seats) => this.reportServing(seats),
      onMeasurement: (m) =>
        console.info(
          `[forge-host] seat=${m.peer} outcome=${m.outcome}` +
            (m.rttMs === undefined ? "" : ` rtt=${Math.round(m.rttMs)}ms`) +
            (m.candidatePair ? ` pair=${m.candidatePair}` : ""),
        ),
    });

    this.unlisten = await listen<BridgeEvent>(BRIDGE_EVENT, (event) => {
      const message = event.payload;
      if (message.kind === "signal") {
        void this.plane?.onSignal(message.from, message.payload);
        return;
      }
      // The node already decided this envelope belongs on this plane. If the
      // channel has gone since, saying so is what puts the seat back on the
      // relay, and the node owes it a board from that moment.
      const sent = this.plane?.sendTo(message.target, message.envelope) ?? false;
      if (!sent) {
        console.warn(`[forge-host] no channel to ${message.target}; reporting it gone`);
        this.reportServing(this.plane?.serving() ?? []);
      }
    });
  }

  /** The roster the webview's own relay session received. The plane reads it
   *  as the host, so it offers to each browser seat in the room. */
  async onRoster(members: RosterMember[], host: RosterMember | undefined): Promise<void> {
    await this.start();
    this.plane?.onRoster(members, host);
  }

  /** Only on change: the roster is rebroadcast on every join and leave, and
   *  the node treats each report as the whole truth. */
  private reportServing(seats: string[]): void {
    const key = seats.join(" ");
    if (key === this.lastServing) return;
    this.lastServing = key;
    void invoke("forge_host_serving", { seats }).catch((error) =>
      console.warn("[forge-host] could not report the served seats:", error),
    );
  }

  stop(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.plane?.close();
    this.plane = null;
    this.starting = null;
    this.lastServing = "";
  }
}
