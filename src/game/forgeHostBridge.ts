/**
 * Drives the WebRTC connections of a desktop-hosted room on the node's behalf.
 * The relay session and the GameStarted freeze stay in the node.
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
  /** The node's relay username; the plane runs as the room's host. */
  private readonly hostUsername: string;
  private readonly iceServers: RTCIceServer[];
  private plane: WebRtcPlane | null = null;
  private unlisten: (() => void) | null = null;
  private starting: Promise<void> | null = null;
  private lastServing = "";

  constructor(hostUsername: string, iceServers: RTCIceServer[] = []) {
    this.hostUsername = hostUsername;
    this.iceServers = iceServers;
  }

  /** True only in the desktop app that runs the room's engine host. */
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
      iceServers: this.iceServers,
      signal: (to, payload) => {
        void invoke("forge_host_signal", { to, payload }).catch((error) =>
          console.warn("[forge-host] could not send signalling:", error),
        );
      },
      deliver: (envelope, fromPlayer) => {
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
      if ((message.envelope as { kind?: string }).kind === "prompt") {
        console.info(`[forge-host] handed a prompt to the plane for ${message.target}`);
      }
      const sent = this.plane?.sendTo(message.target, message.envelope) ?? false;
      if (!sent) {
        console.warn(`[forge-host] no channel to ${message.target}; reporting it gone`);
        this.reportServing(this.plane?.serving() ?? []);
      }
    });
  }

  async onRoster(members: RosterMember[], host: RosterMember | undefined): Promise<void> {
    await this.start();
    this.plane?.onRoster(members, host);
  }

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
