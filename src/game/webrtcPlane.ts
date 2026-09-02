/**
 * The room's WebRTC data plane: one `RTCPeerConnection` per peer, one reliable
 * ordered `RTCDataChannel`, carrying exactly the engine envelopes the relay
 * would have carried.
 *
 * This is the browser half of #838. A browser cannot hole punch with iroh, so
 * for a browser-hosted room WebRTC is the only direct transport there is. The
 * relay carries the offer, the answer and the ICE candidates, and nothing
 * else: once the channel opens the envelopes stop crossing it.
 *
 * Three things this deliberately does the awkward way, because the mixed
 * desktop/browser case has to stay cheap later:
 *
 *  - peers are addressed by USERNAME, never by peer type, so a desktop seat
 *    can use this same signalling path;
 *  - the plane a room uses comes from what the HOST advertises in the roster,
 *    not from "am I a browser", so a desktop seat in a browser-hosted room
 *    picks WebRTC instead of reaching for its native endpoint and finding
 *    nothing;
 *  - `trySend` returns false rather than throwing, so this is a sink beside
 *    the relay rather than a replacement for it.
 *
 * Both ends freeze on `GameStarted`, the same relay message the iroh path
 * uses, which is how they agree on a transport for a game without negotiating
 * one.
 */
import type { StateEnvelope } from "@/types/server";

/** Matches `TRANSPORT_KIND_WEBRTC` in manabrew-relay-protocol. */
export const TRANSPORT_KIND_WEBRTC = "webrtc";
/** Matches `TRANSPORT_KIND_IROH`. An endpoint with no `kinds` means this. */
export const TRANSPORT_KIND_IROH = "iroh";

/** The label is part of the handshake: both ends open the same one. */
const CHANNEL_LABEL = "manabrew-engine";

/** A peer that has neither connected nor failed by now is treated as failed.
 *  ICE gives up on its own eventually, but not on any timescale a player
 *  waiting for a game to start would accept. */
const CONNECT_TIMEOUT_MS = 8_000;

/** Round trips for the RTT probe, and the gap between them. Enough to see a
 *  median without making the channel's first seconds about measurement. */
const PROBE_COUNT = 5;
const PROBE_GAP_MS = 250;

/** A probe, not an envelope. Engine envelopes are objects with a `kind`, so a
 *  string discriminator cannot collide with one. */
interface ProbeMessage {
  __probe: "ping" | "pong";
  seq: number;
  at: number;
}

export interface RosterMember {
  username: string;
  endpoint?: { endpoint_id?: string; kinds?: string[] };
  host?: boolean;
}

/** What the spike is for: whether the channel opened at all, and how it
 *  compares with the relay path it replaced. */
export interface PlaneMeasurement {
  peer: string;
  /** `connected`, `failed` or `timeout`. */
  outcome: string;
  /** Wall clock from first offer to the channel opening. */
  connectMs?: number;
  /** Median of `PROBE_COUNT` round trips on the data channel. */
  rttMs?: number;
  /** The ICE pair that won, as `local/remote` candidate types: `host/host` is
   *  a LAN pair, `srflx` means it was punched through, `relay` means TURN,
   *  which we do not run. */
  candidatePair?: string;
}

export interface WebRtcPlaneOptions {
  /** This client's own username, as the relay attested it. */
  username: string;
  /** Sends a `SignalPeer` to a named room member. */
  signal: (to: string, payload: unknown) => void;
  /** Hands a received envelope to the same path a relay `StateUpdate` takes. */
  deliver: (envelope: StateEnvelope, fromPlayer: string) => void;
  /** Injected so the negotiation can be tested without a browser. */
  createConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  /** ICE servers. Empty means host candidates only, which is a LAN pair and
   *  nothing else. */
  iceServers?: RTCIceServer[];
  onMeasurement?: (measurement: PlaneMeasurement) => void;
  now?: () => number;
}

/** A seat's own envelopes are the only ones it sends. A host sends everything
 *  else, each to the seat it is for. */
function isSeatEnvelope(state: Record<string, unknown>): boolean {
  const kind = (state as Partial<StateEnvelope>).kind;
  return kind === "response" || kind === "directive";
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Whether a roster endpoint speaks a plane, mirroring
 *  `TransportEndpoint::speaks` on the Rust side: absent or empty `kinds` is
 *  what every announcer before the field meant, which is iroh. */
export function endpointSpeaks(member: RosterMember | undefined, kind: string): boolean {
  const kinds = member?.endpoint?.kinds;
  if (!kinds || kinds.length === 0) return kind === TRANSPORT_KIND_IROH;
  return kinds.includes(kind);
}

interface Peer {
  connection: RTCPeerConnection;
  channel: RTCDataChannel | null;
  /** True for the side that offers. Exactly one end of a pair offers, decided
   *  by username order, so both ends cannot glare at each other. */
  offering: boolean;
  open: boolean;
  startedAt: number;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  /** Candidates that arrived before the remote description did. Adding one
   *  early throws, and dropping it can cost the only pair that would have
   *  worked. */
  pending: RTCIceCandidateInit[];
  probes: Map<number, number>;
  rtts: number[];
}

export class WebRtcPlane {
  private readonly opts: Required<Pick<WebRtcPlaneOptions, "username" | "signal" | "deliver">> &
    WebRtcPlaneOptions;
  private readonly peers = new Map<string, Peer>();
  private readonly now: () => number;
  /** The peer a seat sends to: the room's host. A host has no single peer and
   *  routes by target instead. */
  private hostPeer: string | null = null;
  private isHost = false;
  /** Frozen at `GameStarted`. Until then nothing is sent on this plane, and
   *  after it the set never changes for the life of the game. */
  private active = new Set<string>();
  private closed = false;

  constructor(opts: WebRtcPlaneOptions) {
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
  }

  /** What this client announces to the relay. A browser has no address to
   *  publish: the endpoint id names it in the roster and the addresses come
   *  from ICE, over signalling, later. */
  endpoint(): { endpoint_id: string; kinds: string[] } {
    return { endpoint_id: `webrtc:${this.opts.username}`, kinds: [TRANSPORT_KIND_WEBRTC] };
  }

  /** Whether this build can offer the plane at all. */
  static supported(create?: WebRtcPlaneOptions["createConnection"]): boolean {
    return Boolean(create) || typeof RTCPeerConnection !== "undefined";
  }

  /**
   * Installs the relay's roster. The host's advertised kinds decide the room's
   * plane; this client's own platform does not come into it.
   */
  onRoster(members: RosterMember[], host: RosterMember | undefined): void {
    if (this.closed) return;
    if (!endpointSpeaks(host, TRANSPORT_KIND_WEBRTC)) return;
    const hostname = host?.username;
    if (!hostname) return;
    this.isHost = hostname === this.opts.username;
    this.hostPeer = this.isHost ? null : hostname;

    // A seat talks to the host and to nobody else: engine envelopes only ever
    // cross that one edge. Meshing every pair would be connections nothing
    // sends on.
    //
    // A host peers only with members that announced they speak this plane. The
    // roster can hold an iroh endpoint beside a WebRTC one — that is the mixed
    // room — and offering to a peer that cannot answer buys a timeout and a
    // fallback that was already going to happen.
    const wanted = this.isHost
      ? members
          .filter(
            (m) => m.username !== this.opts.username && endpointSpeaks(m, TRANSPORT_KIND_WEBRTC),
          )
          .map((m) => m.username)
      : [hostname];

    for (const peer of wanted) {
      if (!this.peers.has(peer)) void this.open(peer);
    }
    for (const [peer, state] of this.peers) {
      if (!wanted.includes(peer)) {
        this.teardown(peer, state);
      }
    }
  }

  /**
   * A signalling blob from a named peer. `from` is the relay's own view of the
   * sender, so it is safe to key a connection on.
   */
  async onSignal(from: string, payload: unknown): Promise<void> {
    if (this.closed) return;
    const message = payload as { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };
    // A peer that offers to us before the roster named it is still a peer the
    // relay placed in this room, so the connection is created here too. Only
    // the offering side is decided in advance.
    let peer = this.peers.get(from);
    if (!peer) {
      if (!message.sdp || message.sdp.type !== "offer") return;
      peer = this.create(from, false);
    }
    try {
      if (message.sdp) {
        await peer.connection.setRemoteDescription(message.sdp);
        for (const candidate of peer.pending.splice(0)) {
          await peer.connection.addIceCandidate(candidate);
        }
        if (message.sdp.type === "offer") {
          const answer = await peer.connection.createAnswer();
          await peer.connection.setLocalDescription(answer);
          this.opts.signal(from, { sdp: peer.connection.localDescription ?? answer });
        }
        return;
      }
      if (message.ice) {
        // Before the remote description exists there is nothing to attach a
        // candidate to, and adding one throws. Held, not dropped: it may be
        // the only pair that would have worked.
        if (!peer.connection.remoteDescription) peer.pending.push(message.ice);
        else await peer.connection.addIceCandidate(message.ice);
      }
    } catch (error) {
      console.warn(`[webrtc] signalling with ${from} failed:`, error);
      this.settle(from, peer, "failed");
    }
  }

  /** Both ends freeze here, on the same relay message, so a stream never
   *  changes transport once a game is running. */
  freeze(): void {
    this.active = new Set(
      [...this.peers].filter(([, peer]) => peer.open).map(([username]) => username),
    );
    if (this.active.size) {
      console.info(`[webrtc] playing this game direct to ${[...this.active].join(", ")}`);
    }
  }

  clear(): void {
    this.active = new Set();
  }

  /**
   * Takes this envelope, or says it did not, in which case the caller puts it
   * on the relay. Never throws: a plane that can fail a send is a plane that
   * can lose a prompt response, and the seat behind it waits for a resync.
   */
  trySend(state: Record<string, unknown>, targetPlayer?: string): boolean {
    if (this.closed || !this.active.size) return false;
    const peer = this.isHost ? targetPlayer : this.hostPeer;
    // A host envelope with no target is for the whole room, and the relay is
    // the only thing that fans one out.
    if (!peer || !this.active.has(peer)) return false;
    if (!this.isHost && !isSeatEnvelope(state)) return false;
    const channel = this.peers.get(peer)?.channel;
    if (!channel || channel.readyState !== "open") return false;
    try {
      channel.send(JSON.stringify(state));
      return true;
    } catch (error) {
      console.warn(`[webrtc] send to ${peer} failed, falling back to the relay:`, error);
      this.active.delete(peer);
      return false;
    }
  }

  close(): void {
    this.closed = true;
    for (const [peer, state] of this.peers) this.teardown(peer, state);
    this.active = new Set();
  }

  // ── negotiation ──────────────────────────────────────────────────

  private create(peer: string, offering: boolean): Peer {
    const create =
      this.opts.createConnection ?? ((config: RTCConfiguration) => new RTCPeerConnection(config));
    const connection = create({ iceServers: this.opts.iceServers ?? [] });
    const state: Peer = {
      connection,
      channel: null,
      offering,
      open: false,
      startedAt: this.now(),
      settled: false,
      timer: null,
      pending: [],
      probes: new Map(),
      rtts: [],
    };
    this.peers.set(peer, state);

    connection.onicecandidate = (event) => {
      if (event.candidate) this.opts.signal(peer, { ice: event.candidate.toJSON() });
    };
    connection.onconnectionstatechange = () => {
      const status = connection.connectionState;
      if (status === "failed" || status === "closed") this.settle(peer, state, "failed");
    };
    // The answering side never creates a channel; it receives the offerer's.
    connection.ondatachannel = (event) => this.attach(peer, state, event.channel);

    state.timer = setTimeout(() => this.settle(peer, state, "timeout"), CONNECT_TIMEOUT_MS);
    return state;
  }

  private async open(peer: string): Promise<void> {
    // Exactly one end of a pair offers, and both ends work it out from the two
    // usernames alone. Otherwise each offers, each answers, and the pair
    // glares until one side's rollback saves it.
    const offering = this.opts.username < peer;
    const state = this.create(peer, offering);
    if (!offering) return;
    try {
      this.attach(
        peer,
        state,
        state.connection.createDataChannel(CHANNEL_LABEL, { ordered: true }),
      );
      const offer = await state.connection.createOffer();
      await state.connection.setLocalDescription(offer);
      this.opts.signal(peer, { sdp: state.connection.localDescription ?? offer });
    } catch (error) {
      console.warn(`[webrtc] could not offer to ${peer}:`, error);
      this.settle(peer, state, "failed");
    }
  }

  private attach(peer: string, state: Peer, channel: RTCDataChannel): void {
    state.channel = channel;
    channel.onopen = () => {
      state.open = true;
      this.settle(peer, state, "connected");
      void this.probe(peer, state);
    };
    channel.onclose = () => {
      state.open = false;
      this.active.delete(peer);
    };
    channel.onmessage = (event) => this.receive(peer, state, event.data);
  }

  private receive(peer: string, state: Peer, data: unknown): void {
    let parsed: unknown;
    try {
      parsed = typeof data === "string" ? JSON.parse(data) : data;
    } catch {
      return;
    }
    const probe = parsed as ProbeMessage;
    if (probe?.__probe === "ping") {
      state.channel?.send(JSON.stringify({ __probe: "pong", seq: probe.seq, at: probe.at }));
      return;
    }
    if (probe?.__probe === "pong") {
      const sent = state.probes.get(probe.seq);
      if (sent !== undefined) {
        state.rtts.push(this.now() - sent);
        state.probes.delete(probe.seq);
      }
      return;
    }
    // A seat receives from the host and reports no sender, exactly as the
    // relay's own `StateUpdate` does for a host envelope. A host receives from
    // the seat and must name it, because the engine routes responses by seat.
    this.opts.deliver(parsed as StateEnvelope, this.isHost ? peer : "");
  }

  /** Measures the channel so the spike has a number to compare with the relay
   *  path. Fire and forget: nothing waits on it. */
  private async probe(peer: string, state: Peer): Promise<void> {
    for (let seq = 0; seq < PROBE_COUNT; seq += 1) {
      if (!state.open || this.closed) break;
      const at = this.now();
      state.probes.set(seq, at);
      try {
        state.channel?.send(JSON.stringify({ __probe: "ping", seq, at }));
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, PROBE_GAP_MS));
    }
    const rttMs = median(state.rtts);
    if (rttMs === undefined) return;
    this.report({
      peer,
      outcome: "connected",
      rttMs,
      candidatePair: await this.candidatePair(state),
    });
  }

  /** Which pair ICE settled on, which is what says whether this was a LAN hop,
   *  a punched-through path, or TURN. */
  private async candidatePair(state: Peer): Promise<string | undefined> {
    try {
      const stats = await state.connection.getStats();
      let pair: { localCandidateId?: string; remoteCandidateId?: string } | undefined;
      const candidates = new Map<string, string>();
      stats.forEach((report: Record<string, unknown>) => {
        if (report.type === "candidate-pair" && (report.selected || report.state === "succeeded")) {
          pair = report as typeof pair;
        }
        if (report.type === "local-candidate" || report.type === "remote-candidate") {
          candidates.set(String(report.id), String(report.candidateType));
        }
      });
      if (!pair) return undefined;
      const local = candidates.get(String(pair.localCandidateId)) ?? "?";
      const remote = candidates.get(String(pair.remoteCandidateId)) ?? "?";
      return `${local}/${remote}`;
    } catch {
      return undefined;
    }
  }

  /** One outcome per peer. `connected` may be reported twice, once when the
   *  channel opens and again with the RTT, and the caller is told both. */
  private settle(peer: string, state: Peer, outcome: string): void {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    if (state.settled) return;
    state.settled = true;
    if (outcome !== "connected") {
      console.warn(`[webrtc] ${peer} stayed on the relay: ${outcome}`);
    }
    this.report({ peer, outcome, connectMs: this.now() - state.startedAt });
  }

  private report(measurement: PlaneMeasurement): void {
    try {
      this.opts.onMeasurement?.(measurement);
    } catch {
      // Measurement must never take a game down with it.
    }
  }

  private teardown(peer: string, state: Peer): void {
    if (state.timer) clearTimeout(state.timer);
    state.channel?.close();
    state.connection.close();
    this.peers.delete(peer);
    this.active.delete(peer);
  }
}
