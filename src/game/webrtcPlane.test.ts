/**
 * The negotiation and the fallback, driven against a fake `RTCPeerConnection`.
 * Two real browsers is the other half of this spike and cannot run here; what
 * can run here is every rule the plane has to obey no matter which browser it
 * is in.
 */
import { describe, expect, it, vi } from "vitest";
import {
  WebRtcPlane,
  endpointSpeaks,
  iceServersFrom,
  planeForRoom,
  webRtcEndpoint,
  TRANSPORT_KIND_IROH,
  TRANSPORT_KIND_WEBRTC,
} from "./webrtcPlane";
import type { RosterMember } from "./webrtcPlane";

class FakeChannel {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readyState = "connecting";
  readonly sent: string[] = [];
  peer: FakeChannel | null = null;

  send(data: string): void {
    if (this.readyState !== "open") throw new Error("not open");
    this.sent.push(data);
    // Delivered on a later turn, the way a real channel does, so nothing here
    // accidentally depends on a synchronous round trip.
    queueMicrotask(() => this.peer?.onmessage?.({ data }));
  }

  open(): void {
    this.readyState = "open";
    this.onopen?.();
  }

  close(): void {
    this.readyState = "closed";
    this.onclose?.();
  }
}

class FakeConnection {
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((event: { channel: FakeChannel }) => void) | null = null;
  connectionState = "new";
  localDescription: unknown = null;
  remoteDescription: unknown = null;
  channel: FakeChannel | null = null;
  readonly added: unknown[] = [];

  createDataChannel(): FakeChannel {
    this.channel = new FakeChannel();
    return this.channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "offer-sdp" };
  }
  async createAnswer() {
    return { type: "answer", sdp: "answer-sdp" };
  }
  async setLocalDescription(d: unknown) {
    this.localDescription = d;
  }
  async setRemoteDescription(d: unknown) {
    this.remoteDescription = d;
  }
  async addIceCandidate(c: unknown) {
    if (!this.remoteDescription) throw new Error("no remote description");
    this.added.push(c);
  }
  async getStats() {
    return new Map();
  }
  close() {
    this.connectionState = "closed";
  }
}

interface Signal {
  to: string;
  payload: { sdp?: { type: string }; ice?: unknown };
}

interface Delivery {
  envelope: unknown;
  from: string;
}

interface Harness {
  plane: WebRtcPlane;
  connections: Map<string, FakeConnection>;
  signals: Signal[];
  delivered: Delivery[];
}

function harness(username: string, peers: string[]): Harness {
  const connections = new Map<string, FakeConnection>();
  const signals: Signal[] = [];
  const delivered: Delivery[] = [];
  // The plane creates one connection per peer in roster order, which is what
  // lets the fake hand back a connection the test can address by name.
  const queue = [...peers];
  const plane = new WebRtcPlane({
    username,
    signal: (to, payload) => signals.push({ to, payload: payload as Signal["payload"] }),
    deliver: (envelope, from) => delivered.push({ envelope, from }),
    createConnection: () => {
      const connection = new FakeConnection();
      connections.set(queue.shift()!, connection);
      return connection as unknown as RTCPeerConnection;
    },
  });
  return { plane, connections, signals, delivered };
}

/** The RTT probe starts as soon as a channel opens, so the frames a test cares
 *  about are the ones that are not probes. */
function envelopes(channel: FakeChannel): unknown[] {
  return channel.sent
    .map((raw) => JSON.parse(raw) as Record<string, unknown>)
    .filter((frame) => !frame.__probe);
}

function member(username: string, kinds: string[], host = false): RosterMember {
  return { username, endpoint: { endpoint_id: `webrtc:${username}`, kinds }, host };
}

describe("choosing a plane from what the host advertises", () => {
  it("treats an endpoint with no kinds as iroh, which is what every announcer before the field meant", () => {
    expect(endpointSpeaks({ username: "h", endpoint: {} }, "iroh")).toBe(true);
    expect(endpointSpeaks({ username: "h", endpoint: {} }, TRANSPORT_KIND_WEBRTC)).toBe(false);
  });

  it("gives a desktop seat iroh and a browser seat WebRTC out of the same desktop host", () => {
    // A desktop host advertises both, most preferred first.
    const desktopHost = member("alice", ["iroh", "webrtc"], true);
    expect(planeForRoom(desktopHost, ["iroh", "webrtc"])).toBe(TRANSPORT_KIND_IROH);
    expect(planeForRoom(desktopHost, ["webrtc"])).toBe(TRANSPORT_KIND_WEBRTC);
  });

  it("gives a desktop seat WebRTC in a browser-hosted room, not the native endpoint", () => {
    // The seat's own platform must not decide: reaching for iroh here would
    // find nothing and fall back to the relay when WebRTC was available.
    const browserHost = member("alice", ["webrtc"], true);
    expect(planeForRoom(browserHost, ["iroh", "webrtc"])).toBe(TRANSPORT_KIND_WEBRTC);
  });

  it("leaves a browser seat on the relay in an iroh-only room, which is all it can do", () => {
    expect(planeForRoom(member("alice", ["iroh"], true), ["webrtc"])).toBeNull();
    // And an endpoint from before `kinds` existed reads as iroh.
    expect(planeForRoom({ username: "alice", endpoint: {} }, ["webrtc"])).toBeNull();
    expect(planeForRoom({ username: "alice", endpoint: {} }, ["iroh"])).toBe(TRANSPORT_KIND_IROH);
  });

  it("ignores a room whose host speaks iroh, rather than offering into silence", () => {
    const h = harness("alice", ["bob"]);
    h.plane.onRoster(
      [member("alice", ["webrtc"]), member("bob", ["iroh"], true)],
      member("bob", ["iroh"], true),
    );
    expect(h.signals).toHaveLength(0);
  });
});

describe("announcing, which is what starts everything", () => {
  it("is a name and no address, so it costs nothing to send on entering a room", () => {
    // The whole reason this can be announced eagerly. A browser has no address
    // to publish and binds no socket; the addresses cross later over
    // signalling. The relay only sends a roster once a member has announced,
    // and a browser-hosted room has no node to do it unprompted, so an
    // announcement that waits for a roster waits forever.
    expect(webRtcEndpoint("alice")).toEqual({
      endpoint_id: "webrtc:alice",
      kinds: [TRANSPORT_KIND_WEBRTC],
    });
  });

  it("matches what the plane itself would announce", () => {
    const plane = new WebRtcPlane({
      username: "alice",
      signal: () => {},
      deliver: () => {},
      createConnection: () => new FakeConnection() as unknown as RTCPeerConnection,
    });
    expect(plane.endpoint()).toEqual(webRtcEndpoint("alice"));
  });
});

describe("ice servers, which the relay is the only source of", () => {
  it("reads what a roster published, in the shape RTCPeerConnection wants", () => {
    expect(
      iceServersFrom({
        ice_servers: [
          { urls: ["stun:a.example.org"] },
          { urls: ["turn:t.example.org"], username: "u", credential: "p" },
        ],
      }),
    ).toEqual([
      { urls: ["stun:a.example.org"] },
      { urls: ["turn:t.example.org"], username: "u", credential: "p" },
    ]);
  });

  it("ignores an entry with no urls, which RTCPeerConnection cannot use", () => {
    expect(iceServersFrom({ ice_servers: [{ urls: [] }, { username: "u" }] })).toEqual([]);
    // An older relay sends no field at all.
    expect(iceServersFrom({})).toEqual([]);
  });

  it("hands them to every connection it builds", async () => {
    const configs: RTCConfiguration[] = [];
    const plane = new WebRtcPlane({
      username: "alice",
      signal: () => {},
      deliver: () => {},
      iceServers: [{ urls: ["stun:a.example.org"] }],
      createConnection: (config) => {
        configs.push(config);
        return new FakeConnection() as unknown as RTCPeerConnection;
      },
    });
    plane.onRoster(
      [member("alice", ["webrtc"]), member("bob", ["webrtc"])],
      member("alice", ["webrtc"], true),
    );
    await vi.waitFor(() => expect(configs.length).toBeGreaterThan(0));
    // Without these a browser gathers host candidates only, which Chromium
    // replaces with mDNS names, and ICE never leaves "new".
    expect(configs[0].iceServers).toEqual([{ urls: ["stun:a.example.org"] }]);
  });
});

describe("negotiation", () => {
  it("offers from exactly one end of a pair, so the two cannot glare", async () => {
    const host = member("alice", ["webrtc"], true);
    // alice < bob, so alice offers and bob waits.
    const a = harness("alice", ["bob"]);
    a.plane.onRoster([member("alice", ["webrtc"]), member("bob", ["webrtc"])], host);
    await vi.waitFor(() => expect(a.signals.length).toBeGreaterThan(0));
    expect(a.signals[0].payload.sdp?.type).toBe("offer");

    const b = harness("bob", ["alice"]);
    b.plane.onRoster([member("alice", ["webrtc"]), member("bob", ["webrtc"])], host);
    expect(b.signals).toHaveLength(0);
  });

  it("hangs up every peer when the roster comes back without a host", async () => {
    // The relay empties the roster while a player at the table has not opted
    // in. A connection made before that player sat down must not survive to
    // the freeze, or one seat would play direct at a table that did not agree.
    const host = member("alice", ["webrtc"], true);
    const a = harness("alice", ["bob"]);
    a.plane.onRoster([member("alice", ["webrtc"]), member("bob", ["webrtc"])], host);
    await vi.waitFor(() => expect(a.connections.has("bob")).toBe(true));
    const bob = a.connections.get("bob")!;
    bob.channel!.open();
    expect(a.plane.serving()).toEqual(["bob"]);

    a.plane.onRoster([], undefined);
    expect(bob.connectionState).toBe("closed");
    expect(a.plane.serving()).toEqual([]);
    a.plane.freeze();
    expect(a.plane.trySend({ kind: "prompt" }, "bob")).toBe(false);
  });

  it("does not offer to a member that only speaks iroh, which is the mixed room", async () => {
    const host = member("alice", ["webrtc"], true);
    const h = harness("alice", ["carol"]);
    h.plane.onRoster(
      [member("alice", ["webrtc"]), member("bob", ["iroh"]), member("carol", ["webrtc"])],
      host,
    );
    await vi.waitFor(() => expect(h.signals.length).toBeGreaterThan(0));
    expect(h.signals.map((s) => s.to)).toEqual(["carol"]);
  });

  it("answers an offer from a peer the roster has not named yet", async () => {
    const h = harness("bob", ["alice"]);
    await h.plane.onSignal("alice", { sdp: { type: "offer", sdp: "offer-sdp" } });
    expect(h.signals).toHaveLength(1);
    expect(h.signals[0]).toMatchObject({ to: "alice", payload: { sdp: { type: "answer" } } });
  });

  it("holds a candidate that arrives before the description it would attach to", async () => {
    const h = harness("bob", ["alice"]);
    // A bare candidate cannot create a connection, so this one is dropped: it
    // names a peer nothing has offered to us.
    await h.plane.onSignal("alice", { ice: { candidate: "early" } });
    expect(h.connections.size).toBe(0);

    await h.plane.onSignal("alice", { sdp: { type: "offer", sdp: "offer-sdp" } });
    const connection = h.connections.get("alice")!;
    await h.plane.onSignal("alice", { ice: { candidate: "late" } });
    expect(connection.added).toEqual([{ candidate: "late" }]);
  });
});

describe("the send seam", () => {
  async function connectedSeat() {
    const host = member("alice", ["webrtc"], true);
    const h = harness("bob", ["alice"]);
    // bob answers alice, so the channel arrives on `ondatachannel`.
    await h.plane.onSignal("alice", { sdp: { type: "offer", sdp: "offer-sdp" } });
    const connection = h.connections.get("alice")!;
    const channel = new FakeChannel();
    connection.ondatachannel?.({ channel });
    channel.open();
    h.plane.onRoster([member("alice", ["webrtc"]), member("bob", ["webrtc"])], host);
    return { ...h, channel };
  }

  it("sends nothing until GameStarted freezes the transport", async () => {
    const { plane, channel } = await connectedSeat();
    expect(plane.trySend({ kind: "response" })).toBe(false);
    plane.freeze();
    expect(plane.trySend({ kind: "response" })).toBe(true);
    expect(envelopes(channel)).toEqual([{ kind: "response" }]);
  });

  it("carries only a seat's own envelopes, and leaves the rest on the relay", async () => {
    const { plane } = await connectedSeat();
    plane.freeze();
    expect(plane.trySend({ kind: "directive" })).toBe(true);
    // A seat never emits these; if one appeared it belongs on the relay, which
    // is the only thing that fans out to a room.
    expect(plane.trySend({ kind: "state" })).toBe(false);
  });

  it("falls back to the relay when the channel closes mid-game", async () => {
    const { plane, channel } = await connectedSeat();
    plane.freeze();
    expect(plane.trySend({ kind: "response" })).toBe(true);
    channel.close();
    expect(plane.trySend({ kind: "response" })).toBe(false);
  });

  it("reports failure without throwing, so an envelope is never lost between planes", async () => {
    const { plane, channel } = await connectedSeat();
    plane.freeze();
    channel.readyState = "open";
    channel.send = () => {
      throw new Error("channel broke");
    };
    expect(plane.trySend({ kind: "response" })).toBe(false);
  });
});

describe("a host", () => {
  async function connectedHost() {
    const host = member("alice", ["webrtc"], true);
    const h = harness("alice", ["bob"]);
    h.plane.onRoster([member("alice", ["webrtc"]), member("bob", ["webrtc"])], host);
    await vi.waitFor(() => expect(h.connections.get("bob")).toBeDefined());
    const connection = h.connections.get("bob")!;
    await vi.waitFor(() => expect(connection.channel).toBeDefined());
    connection.channel!.open();
    return { ...h, channel: connection.channel! };
  }

  it("serves each seat over its own channel, not only receives answers", async () => {
    const { plane, channel } = await connectedHost();
    plane.freeze();
    expect(plane.trySend({ kind: "prompt" }, "bob")).toBe(true);
    expect(envelopes(channel)).toEqual([{ kind: "prompt" }]);
  });

  it("leaves a room-wide envelope on the relay, the only thing that fans one out", async () => {
    const { plane } = await connectedHost();
    plane.freeze();
    expect(plane.trySend({ kind: "state" })).toBe(false);
  });

  it("names the seat an envelope came from, because the engine routes responses by seat", async () => {
    const { channel, delivered } = await connectedHost();
    channel.onmessage?.({ data: JSON.stringify({ kind: "response" }) });
    expect(delivered).toEqual([{ envelope: { kind: "response" }, from: "bob" }]);
  });
});

describe("a host proxy, whose freeze lives in the node", () => {
  async function connectedHost() {
    const host = member("alice", ["iroh", "webrtc"], true);
    const h = harness("alice", ["bob"]);
    h.plane.onRoster([member("alice", ["iroh", "webrtc"]), member("bob", ["webrtc"])], host);
    await vi.waitFor(() => expect(h.connections.get("bob")).toBeDefined());
    const connection = h.connections.get("bob")!;
    await vi.waitFor(() => expect(connection.channel).toBeDefined());
    connection.channel!.open();
    return { ...h, channel: connection.channel! };
  }

  it("sends without a local freeze, because the node already decided", async () => {
    const { plane, channel } = await connectedHost();
    // `trySend` would refuse: nothing froze here. `sendTo` is the proxy's path.
    expect(plane.trySend({ kind: "prompt" }, "bob")).toBe(false);
    expect(plane.sendTo("bob", { kind: "prompt" })).toBe(true);
    expect(envelopes(channel)).toEqual([{ kind: "prompt" }]);
  });

  it("refuses once the channel is gone, which is what puts the seat back on the relay", async () => {
    const { plane, channel } = await connectedHost();
    channel.close();
    expect(plane.sendTo("bob", { kind: "prompt" })).toBe(false);
  });

  it("reports the seats it is serving as channels open and close", async () => {
    const seen: string[][] = [];
    const host = member("alice", ["iroh", "webrtc"], true);
    const connections = new Map<string, FakeConnection>();
    const queue = ["bob"];
    const plane = new WebRtcPlane({
      username: "alice",
      signal: () => {},
      deliver: () => {},
      onServing: (seats) => seen.push(seats),
      createConnection: () => {
        const connection = new FakeConnection();
        connections.set(queue.shift()!, connection);
        return connection as unknown as RTCPeerConnection;
      },
    });
    plane.onRoster([member("alice", ["iroh", "webrtc"]), member("bob", ["webrtc"])], host);
    await vi.waitFor(() => expect(connections.get("bob")?.channel).toBeDefined());
    connections.get("bob")!.channel!.open();
    expect(plane.serving()).toEqual(["bob"]);
    connections.get("bob")!.channel!.close();
    expect(plane.serving()).toEqual([]);
    expect(seen).toContainEqual(["bob"]);
    expect(seen.at(-1)).toEqual([]);
  });
});

describe("measurement", () => {
  it("answers a probe without handing it to the engine", async () => {
    const h = harness("bob", ["alice"]);
    await h.plane.onSignal("alice", { sdp: { type: "offer", sdp: "offer-sdp" } });
    const connection = h.connections.get("alice")!;
    const channel = new FakeChannel();
    connection.ondatachannel?.({ channel });
    channel.open();
    channel.onmessage?.({ data: JSON.stringify({ __probe: "ping", seq: 0, at: 1 }) });
    expect(JSON.parse(channel.sent.at(-1)!)).toMatchObject({ __probe: "pong", seq: 0 });
    expect(h.delivered).toHaveLength(0);
  });
});
