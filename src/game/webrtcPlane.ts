/**
 * The room's WebRTC data plane: one `RTCPeerConnection` and one reliable
 * ordered channel per peer, carrying the same engine envelopes the relay would.
 * The browser half of #838: a browser cannot hole punch with iroh, so WebRTC is
 * its only direct transport. The relay carries only the offer, answer and ICE.
 *
 * Peers are addressed by username (so a desktop seat uses this path too), the
 * plane comes from what the host advertises (not "am I a browser"), and
 * `trySend` returns false rather than throwing. Both ends freeze on
 * `GameStarted`. See docs/TRANSPORT.md.
 */
import type { StateEnvelope } from "@/types/server";

/** Matches `TRANSPORT_KIND_WEBRTC` in manabrew-relay-protocol. */
export const TRANSPORT_KIND_WEBRTC = "webrtc";
/** Matches `TRANSPORT_KIND_IROH`. An endpoint with no `kinds` means this. */
export const TRANSPORT_KIND_IROH = "iroh";

/** The label is part of the handshake: both ends open the same one. */
const CHANNEL_LABEL = "manabrew-engine";

/** A peer neither connected nor failed by now counts as failed. Nothing waits
 *  on it (the seat plays on the relay throughout), so the budget is ICE's, not
 *  a guess at player patience; Firefox's own is nearer 30s. */
const CONNECT_TIMEOUT_MS = 25_000;

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
  /** `settled` is the attempt reaching its outcome, once. `measured` is the
   *  later refinement that carries the round trip.
   *
   *  A connected peer reports twice, and without telling the two apart anything
   *  counting attempts counts a success twice and a failure once -- which
   *  inflates exactly the connect rate this measurement exists to establish. */
  phase: "settled" | "measured";
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
  /** The peers with an open channel, whenever that set changes. A host proxy
   *  reports it onward so the node knows which seats it can still reach. */
  onServing?: (seats: string[]) => void;
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
  return advertisedKinds(member).includes(kind);
}

function advertisedKinds(member: RosterMember | undefined): string[] {
  const kinds = member?.endpoint?.kinds;
  return !kinds || kinds.length === 0 ? [TRANSPORT_KIND_IROH] : kinds;
}

/**
 * The plane a seat takes: the first one the HOST advertises that this client
 * speaks. The host's list carries the preference, so a desktop seat lands on
 * iroh in a desktop-hosted room and on WebRTC in a browser-hosted one.
 */
export function planeForRoom(host: RosterMember | undefined, mine: string[]): string | null {
  return advertisedKinds(host).find((kind) => mine.includes(kind)) ?? null;
}

/**
 * The ICE servers a roster published, in the shape `RTCPeerConnection` wants.
 * The relay is the only source: no client hardcodes one, the same rule the
 * iroh relay url follows, so a self-hosted deployment answers the question by
 * configuring its relay rather than by shipping new clients.
 */
export function iceServersFrom(msg: Record<string, unknown>): RTCIceServer[] {
  const raw = msg.ice_servers;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => entry as { urls?: string[]; username?: string; credential?: string })
    .filter((entry) => Array.isArray(entry.urls) && entry.urls.length > 0)
    .map((entry) => ({
      urls: entry.urls!,
      ...(entry.username ? { username: entry.username } : {}),
      ...(entry.credential ? { credential: entry.credential } : {}),
    }));
}

/**
 * What a browser announces: a name, no address. The addresses cross later over
 * signalling, so announcing costs nothing and happens on entering a room.
 */
export function webRtcEndpoint(username: string): { endpoint_id: string; kinds: string[] } {
  return { endpoint_id: `webrtc:${username}`, kinds: [TRANSPORT_KIND_WEBRTC] };
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
    return webRtcEndpoint(this.opts.username);
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
    // A roster with no host is the relay withdrawing the plane: somebody at
    // the table has not opted in. Every connection goes, so that nothing is
    // open when `GameStarted` freezes the transport.
    if (!host) {
      for (const [peer, state] of this.peers) this.teardown(peer, state);
      return;
    }
    if (!endpointSpeaks(host, TRANSPORT_KIND_WEBRTC)) return;
    const hostname = host.username;
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
    return this.sendTo(peer, state);
  }

  /**
   * Puts one envelope on a peer's channel. Separate from `trySend` for the
   * host proxy, whose barrier lives in the node rather than here: the node
   * froze the seat set at `GameStarted` and decided this envelope belongs on
   * this plane, so there is no second gate to pass.
   */
  sendTo(peer: string, envelope: unknown): boolean {
    if (this.closed) return false;
    const channel = this.peers.get(peer)?.channel;
    if (!channel || channel.readyState !== "open") return false;
    try {
      channel.send(JSON.stringify(envelope));
      return true;
    } catch (error) {
      console.warn(`[webrtc] send to ${peer} failed, falling back to the relay:`, error);
      this.active.delete(peer);
      this.announceServing();
      return false;
    }
  }

  /** The peers with an open channel right now. */
  serving(): string[] {
    return [...this.peers]
      .filter(([, peer]) => peer.open && peer.channel?.readyState === "open")
      .map(([username]) => username)
      .sort();
  }

  private announceServing(): void {
    try {
      this.opts.onServing?.(this.serving());
    } catch {
      // Reporting must never take a game down with it.
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
      this.announceServing();
      void this.probe(peer, state);
    };
    channel.onclose = () => {
      state.open = false;
      this.active.delete(peer);
      this.announceServing();
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
      phase: "measured",
      rttMs,
      candidatePair: await this.candidatePair(state),
    });
  }

  /** Which pair ICE settled on, which is what says whether this was a LAN hop,
   *  a punched-through path, or TURN. */
  /**
   * What ICE had to work with, for the case where it did not connect.
   *
   * The winning pair says nothing when there is no winner, and that is exactly
   * when the question matters: `srflx` on both sides means STUN worked and the
   * failure is NAT traversal, where only `host` means STUN produced nothing and
   * traversal was never attempted. Without this the answer lives in
   * `about:webrtc` on one machine and nowhere in the logs.
   */
  private async candidateSummary(state: Peer): Promise<string | undefined> {
    try {
      const stats = await state.connection.getStats();
      const local = new Set<string>();
      const remote = new Set<string>();
      const pairs: string[] = [];
      const byId = new Map<string, string>();
      stats.forEach((report: Record<string, unknown>) => {
        if (report.type === "local-candidate") {
          local.add(String(report.candidateType));
          byId.set(String(report.id), String(report.candidateType));
        }
        if (report.type === "remote-candidate") {
          remote.add(String(report.candidateType));
          byId.set(String(report.id), String(report.candidateType));
        }
      });
      stats.forEach((report: Record<string, unknown>) => {
        if (report.type !== "candidate-pair") return;
        const l = byId.get(String(report.localCandidateId)) ?? "?";
        const r = byId.get(String(report.remoteCandidateId)) ?? "?";
        pairs.push(`${l}/${r}:${report.state ?? "?"}`);
      });
      const fmt = (set: Set<string>) => (set.size ? [...set].sort().join("+") : "none");
      return `local=${fmt(local)} remote=${fmt(remote)} pairs=[${pairs.join(" ")}]`;
    } catch {
      return undefined;
    }
  }

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
    const connectMs = this.now() - state.startedAt;
    if (outcome === "connected") {
      this.report({ peer, outcome, connectMs, phase: "settled" });
      return;
    }
    // Read the candidates before anything tears the connection down, and log
    // them with the failure rather than making somebody open about:webrtc.
    void this.candidateSummary(state).then((summary) => {
      console.warn(
        `[webrtc] ${peer} stayed on the relay: ${outcome}` + (summary ? ` (${summary})` : ""),
      );
      this.report({ peer, outcome, connectMs, candidatePair: summary, phase: "settled" });
    });
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
    this.announceServing();
  }
}
