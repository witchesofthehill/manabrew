/**
 * The room's WebRTC data plane: one connection and one ordered channel per peer.
 * Only the offer, answer and ICE cross the relay. See docs/TRANSPORT.md.
 */
import type { StateEnvelope } from "@/types/server";

/** Matches `TRANSPORT_KIND_WEBRTC` in manabrew-relay-protocol. */
export const TRANSPORT_KIND_WEBRTC = "webrtc";

const CHANNEL_LABEL = "manabrew-engine";

const CONNECT_TIMEOUT_MS = 25_000;

const PROBE_COUNT = 5;
const PROBE_GAP_MS = 250;

const MEASURE_INTERVAL_MS = 15_000;

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

export interface PlaneMeasurement {
  peer: string;
  /** `connected`, `failed` or `timeout`. */
  outcome: string;
  connectMs?: number;
  rttMs?: number;
  /** The winning ICE pair as `local/remote` candidate types. */
  candidatePair?: string;
  /** `settled` once per attempt; `measured` on each later RTT sample. */
  phase: "settled" | "measured";
}

export interface WebRtcPlaneOptions {
  /** Relay-attested; never client supplied. */
  username: string;
  signal: (to: string, payload: unknown) => void;
  /** Takes the same path a relay `StateUpdate` takes. */
  deliver: (envelope: StateEnvelope, fromPlayer: string) => void;
  createConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  iceServers?: RTCIceServer[];
  onMeasurement?: (measurement: PlaneMeasurement) => void;
  /** Peers with an open channel, whenever that set changes. */
  onServing?: (seats: string[]) => void;
  now?: () => number;
}

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

/** Mirrors `TransportEndpoint::speaks` on the Rust side. */
export function endpointSpeaks(member: RosterMember | undefined, kind: string): boolean {
  return advertisedKinds(member).includes(kind);
}

function advertisedKinds(member: RosterMember | undefined): string[] {
  return member?.endpoint?.kinds ?? [];
}

/** The first plane the host advertises that this client speaks. */
export function planeForRoom(host: RosterMember | undefined, mine: string[]): string | null {
  return advertisedKinds(host).find((kind) => mine.includes(kind)) ?? null;
}

/** ICE servers a roster published. No client hardcodes one. */
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

/** The endpoint a browser announces to the relay. */
export function webRtcEndpoint(username: string): { endpoint_id: string; kinds: string[] } {
  return { endpoint_id: `webrtc:${username}`, kinds: [TRANSPORT_KIND_WEBRTC] };
}

interface Peer {
  connection: RTCPeerConnection;
  channel: RTCDataChannel | null;
  offering: boolean;
  open: boolean;
  startedAt: number;
  settled: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  pending: RTCIceCandidateInit[];
  probes: Map<number, number>;
  rtts: number[];
  probeSeq: number;
}

export class WebRtcPlane {
  private readonly opts: Required<Pick<WebRtcPlaneOptions, "username" | "signal" | "deliver">> &
    WebRtcPlaneOptions;
  private readonly peers = new Map<string, Peer>();
  private readonly now: () => number;
  private hostPeer: string | null = null;
  private isHost = false;
  /** Frozen at `GameStarted`; never changes for the life of the game. */
  private active = new Set<string>();
  private closed = false;
  private measureTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: WebRtcPlaneOptions) {
    this.opts = opts;
    this.now = opts.now ?? (() => Date.now());
  }

  endpoint(): { endpoint_id: string; kinds: string[] } {
    return webRtcEndpoint(this.opts.username);
  }

  static supported(create?: WebRtcPlaneOptions["createConnection"]): boolean {
    return Boolean(create) || typeof RTCPeerConnection !== "undefined";
  }

  /** The host's advertised kinds decide the room's plane. */
  onRoster(members: RosterMember[], host: RosterMember | undefined): void {
    if (this.closed) return;
    // No host means the relay withdrew the plane. Hang up before the freeze.
    if (!host) {
      for (const [peer, state] of this.peers) this.teardown(peer, state);
      return;
    }
    if (!endpointSpeaks(host, TRANSPORT_KIND_WEBRTC)) return;
    const hostname = host.username;
    if (!hostname) return;
    this.isHost = hostname === this.opts.username;
    this.hostPeer = this.isHost ? null : hostname;

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

  /** `from` is relay-attested, so it is safe to key a connection on. */
  async onSignal(from: string, payload: unknown): Promise<void> {
    if (this.closed) return;
    const message = payload as { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit };
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
        if (!peer.connection.remoteDescription) peer.pending.push(message.ice);
        else await peer.connection.addIceCandidate(message.ice);
      }
    } catch (error) {
      console.warn(`[webrtc] signalling with ${from} failed:`, error);
      this.settle(from, peer, "failed");
    }
  }

  /** Both ends freeze on `GameStarted`; transport never changes mid-game. */
  freeze(): void {
    this.active = new Set(
      [...this.peers].filter(([, peer]) => peer.open).map(([username]) => username),
    );
    if (this.active.size) {
      console.info(`[webrtc] playing this game direct to ${[...this.active].join(", ")}`);
      this.startMeasuring();
    }
  }

  clear(): void {
    this.active = new Set();
    this.stopMeasuring();
  }

  /** False means the caller sends over the relay. Never throws. */
  trySend(state: Record<string, unknown>, targetPlayer?: string): boolean {
    if (this.closed || !this.active.size) return false;
    const peer = this.isHost ? targetPlayer : this.hostPeer;
    if (!peer || !this.active.has(peer)) return false;
    if (!this.isHost && !isSeatEnvelope(state)) return false;
    return this.sendTo(peer, state);
  }

  /** Host proxy path: the node holds the freeze, so no `trySend` gate here. */
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
    this.stopMeasuring();
    for (const [peer, state] of this.peers) this.teardown(peer, state);
    this.active = new Set();
  }

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
      probeSeq: 0,
    };
    this.peers.set(peer, state);

    connection.onicecandidate = (event) => {
      if (event.candidate) this.opts.signal(peer, { ice: event.candidate.toJSON() });
    };
    connection.onconnectionstatechange = () => {
      const status = connection.connectionState;
      if (status === "failed" || status === "closed") this.settle(peer, state, "failed");
    };
    connection.ondatachannel = (event) => this.attach(peer, state, event.channel);

    state.timer = setTimeout(() => this.settle(peer, state, "timeout"), CONNECT_TIMEOUT_MS);
    return state;
  }

  private async open(peer: string): Promise<void> {
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
    // A host must name the seat: the engine routes responses by seat.
    if ((parsed as { kind?: string })?.kind === "prompt") {
      console.info(
        this.isHost
          ? `[webrtc] received a prompt response from ${peer}`
          : "[webrtc] received a prompt from the host over the data channel",
      );
    }
    this.opts.deliver(parsed as StateEnvelope, this.isHost ? peer : "");
  }

  private async probe(peer: string, state: Peer): Promise<void> {
    const rttMs = await this.sampleRtt(state);
    if (rttMs === undefined) return;
    this.report({
      peer,
      outcome: "connected",
      phase: "measured",
      rttMs,
      candidatePair: await this.candidatePair(state),
    });
  }

  private async sampleRtt(state: Peer): Promise<number | undefined> {
    state.rtts = [];
    for (let i = 0; i < PROBE_COUNT; i += 1) {
      if (!state.open || this.closed) break;
      const seq = state.probeSeq++;
      const at = this.now();
      state.probes.set(seq, at);
      try {
        state.channel?.send(JSON.stringify({ __probe: "ping", seq, at }));
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, PROBE_GAP_MS));
    }
    return median(state.rtts);
  }

  private startMeasuring(): void {
    if (this.measureTimer) return;
    this.measureTimer = setInterval(() => void this.measureAll(), MEASURE_INTERVAL_MS);
  }

  private stopMeasuring(): void {
    if (this.measureTimer) {
      clearInterval(this.measureTimer);
      this.measureTimer = null;
    }
  }

  private async measureAll(): Promise<void> {
    for (const [peer, state] of this.peers) {
      if (this.closed) return;
      if (!this.active.has(peer) || !state.open) continue;
      const rttMs = await this.sampleRtt(state);
      const candidatePair = await this.candidatePair(state);
      console.info(
        `[webrtc] measure peer=${peer} rtt=${rttMs ?? "?"}ms pair=${candidatePair ?? "?"}`,
      );
      if (rttMs !== undefined) {
        this.report({ peer, outcome: "connected", phase: "measured", rttMs, candidatePair });
      }
    }
  }

  /** Every candidate ICE gathered, for logging a failed attempt. */
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
