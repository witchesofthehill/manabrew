# Transport

Game traffic between players in a room goes through `manabrew-server`, which makes two WAN hops
out of what is often one network. This is the seam that lets it go straight between peers
instead.

A native peer is direct over iroh; a browser cannot hole punch, so it is direct over WebRTC or
not at all. Both sit behind the same rendezvous. #838.

## What moves and what does not

The relay keeps everything it is actually trusted for: authentication and identity proofs, the
lobby, room creation and discovery, membership, readiness, deck and engine selection,
`StartGame`/`GameStarted`/`EndGame`, the reconnect window and seat forfeits, the replay cache,
analytics. It also remains a working data plane, forever, as the fallback.

What can move is the engine envelope set, and only that: the host emits `state`, `display`,
`prompt`, `error`, `log`, `snapshot`, `fatal`; seats reply with `Response` and `Directive`. They
travel today inside `ClientMessage::BroadcastState` and come back as `ServerMessage::StateUpdate`,
and the relay never reads the payload except to diff `state` for `stateDelta` patches.

## Rendezvous

The relay is the authority that binds a username to an endpoint id. Nothing else is.

1. A member binds an endpoint and sends `ClientMessage::AnnounceTransport` with its address.
2. The relay records it against that session's player id and rebroadcasts
   `ServerMessage::RoomTransport` to the room: the host, and every member's endpoint, each named
   with the relay's own record of who that session is. A username in the roster is never a
   client-supplied field.
3. A peer dials the host from the roster and sends a `Hello`. The host checks the dialer's
   endpoint id, proven by the QUIC handshake, against the roster. A name claimed in `Hello` is
   worth nothing on its own.

An announcement is refused, silently, if the announcer is not in the room or if another member
already claimed that endpoint id; the announcer stays on the relay and
`manabrew_relay_transport_announcements_total{kind="rejected"}` is where it shows up. Silence is
deliberate: a squatter must not be able to make a real player see an error about a room they are
sitting in.

## Relays

iroh relays coordinate hole punching and carry traffic for a pair that cannot be punched
through. They forward QUIC between endpoint keys and never see plaintext.

`MANABREW_IROH_RELAY_URL` names one; unset, peers take iroh's own defaults. Running our own is a
later question, and a deployment answers it by setting that variable rather than by shipping new
clients. No client hardcodes a relay.

No address lookup service is configured either way. The endpoint is built from `presets::Minimal`
and the roster is the only source of addressing, so endpoint ids are never published to a
third-party DNS or DHT.

## The host

`self-hosted-node` is the engine host, on the fleet and in-process in a desktop app under the
`forge-room` feature. With the `iroh` feature and `SELF_HOSTED_NODE_IROH=1` it offers each seat a
QUIC channel and sends that seat's engine envelopes over it instead of through
`BroadcastState`. `Config::for_desktop_room` turns it on.

It is worth being exact about what that wins. A seat on the same network already reaches a
desktop host in one local hop, through the embedded relay it finds over mDNS
(`manabrew-lan-discovery`), and iroh cannot beat one local hop. The direct plane is for the seat
that is somewhere else: hole punched to the host instead of two WAN hops through
`manabrew.app`.

A seat is chosen for the direct plane at `GameStarted` and never migrates mid-game, in either
direction. A seat whose channel dies goes back to the relay, but not silently: while it was
direct the relay saw none of its envelopes, so the host owes it a full state before anything else
goes out. `SeatTransport::RelayPending` is that debt, paid through `on_fallback` into the ordered
outbound queue, and cleared when the seat answers over the relay, which is the only signal that
it is reading that path again.

The relay cannot observe traffic it does not carry, so the host tells it: `ReportTransport` names
the seats that left, and the relay writes that into the game's capture. Without it a capture file
is silently incomplete and whoever reads it later measures a game they cannot see all of.

## The desktop seat

A desktop binds its own endpoint natively, in the Tauri shell, and the webview drives it through
commands and receives the host's envelopes as events. That is the whole reason it can be direct:
the same seat compiled into the webview would have no IP transports. It is for the seat that is
not on the host's network; one that is already has a single local hop through the LAN relay.

Only the seat's own `Response` and `Directive` envelopes move. Everything else, the entire control
plane included, stays on the relay socket the client already has.

macOS has no WebDriver for WKWebView, so no window can be driven to exercise this. The logic
therefore lives in `DesktopSeat`, with no Tauri in it, and is tested against a real host over a
real connection.

## The browser plane

A browser cannot hole punch, so iroh gives it a relayed connection and nothing more. WebRTC is the
only direct transport it has, and it is a second implementation behind this same rendezvous rather
than a second rendezvous.

`WebRtcPlane` holds one `RTCPeerConnection` per peer and one reliable ordered `RTCDataChannel` on
each, carrying the same engine envelope set. A seat connects to the host and to nobody else,
because that is the only edge envelopes cross.

The relay carries the offer, the answer and the ICE candidates, and stops there.
`ClientMessage::SignalPeer` names a room member by username; the relay does not read the payload,
routes on the name, stamps `from` from its own record of the sending session and forwards
`ServerMessage::PeerSignal`. That is the attestation `RoomTransport` already gives the roster,
applied to signalling. A blob over `MAX_SIGNAL_BYTES` is dropped, because an opaque payload's size
is the only thing the relay can judge it on and the control plane must not become a data plane.

Three rules keep the mixed desktop/browser case cheap:

- **Peers are addressed by username, never by peer type.** A desktop seat uses the same signalling
  path.
- **A room's plane comes from what the host advertises**, in `TransportEndpoint::kinds`, not from
  "am I a browser". A seat takes the first kind the host offers that it can itself speak
  (`planeForRoom`). Otherwise a desktop seat in a browser-hosted room reaches for its native
  endpoint, finds nothing, and falls back to the relay when WebRTC was there. An endpoint with no
  `kinds` means `iroh`, which is what every announcer before the field meant.
- **The send seam takes a second sink rather than a rewrite.** `trySend` returns false and the
  caller puts the envelope on the relay, the same shape `DirectPlane::try_send` has on the Rust
  side.

Exactly one end of a pair offers, decided by username order, so two ends cannot glare at each
other. A candidate that arrives before the description it would attach to is held rather than
dropped: adding it early throws, and it may be the only pair that would have worked. A peer that
has neither connected nor failed within the connect timeout is treated as failed and stays on the
relay.

There is no TURN server, so a WebRTC seat is direct or it is on the relay. `TRANSPORT_WEBRTC` has
no relayed variant for that reason.

### ICE servers

Without a STUN server a browser gathers host candidates only, and Chromium
replaces those with mDNS names. Measured against the staging relay on
2026-09-02, two Chrome tabs each offered exactly one candidate:

```
a=candidate:... 0848d8e7-….local 57333 typ host
a=candidate:... 55aae59b-….local 50149 typ host
```

`iceConnectionState` never left `new`. Not a pairing failure: ICE never
started. Adding a STUN server produced `srflx` candidates and took it to
`checking`.

So an empty list is not a neutral default. It leaves the plane able to reach a
peer on the same network at best, and a seat on the same network already has
one local hop through the embedded relay, which nothing beats. Without ICE
servers the browser plane has no case it wins.

`MANABREW_ICE_SERVERS` on the relay names them and `RoomTransport` carries them
to every member, the same way `MANABREW_IROH_RELAY_URL` works and for the same
reason: no client hardcodes one, so a deployment answers the question by
configuring its relay rather than by shipping new clients. A comma separated
url list covers STUN; a JSON array of `RTCIceServer` covers TURN, which needs a
username and a credential. Unparseable config yields no servers rather than a
refusal to start, because a relay that will not boot serves nobody.

### Running the STUN server

`compose.staging.yml` carries a STUN-only coturn behind a `stun` profile, so a
normal deploy neither starts it nor waits on it. Three steps, in order, because
each is useless without the one before:

1. Open UDP 3478 on the box. Nothing else there uses UDP, so this is a firewall
   change rather than a deploy.
2. `docker compose -f compose.staging.yml --profile stun up -d coturn-staging`
3. Set `MANABREW_ICE_SERVERS=stun:relay-staging.manabrew.app:3478` and recreate
   the relay.

Naming a STUN server that is not answering is worse than naming none: ICE
gathering waits out the timeout and then produces the same host-only candidates
anyway. So step 3 comes last, and until it is done a client says in its console
that it was handed nothing.

`network_mode: host` on that container is load-bearing, not a shortcut. A STUN
server answers with the source address it observed, so anything that rewrites
the client's source on the way in makes it answer with that address instead,
and every peer is handed one no other peer can reach. Publishing a port through
the docker proxy does exactly that.

`--stun-only` makes it refuse allocation requests, so it cannot become a data
path by accident or because somebody else pointed a client at it.

Whether TURN is needed is a separate question from whether STUN is. STUN is
what makes a hole-punched pair possible at all; TURN is the fallback for the
pairs that cannot be punched, and running one means carrying their traffic. The
epic rejected a relay bridge for that reason. Start with STUN and read
`manabrew_relay_peer_signals_total` and the client's connect outcomes before
deciding.

### What the spike measures

Every peer reports once when it settles, with the outcome and how long it took, and again with the
median of a short `RTCDataChannel` ping/pong. The probe frames carry a `__probe` discriminator, so
they cannot be confused with an engine envelope, which is always an object with a `kind`. The
client's own keepalive round trip to the relay is logged beside it, which is the number the direct
plane has to beat.

`manabrew_relay_peer_signals_total{kind}` counts what the relay did with each signal: forwarded, or
why not. A negotiation that never completes shows up there, because a dropped signal is answered
with silence the same way a rejected announcement is.

### A desktop host serving a browser seat

Two thirds of mixed rooms are desktop-hosted, and that host cannot dial a browser. Its engine is
`self-hosted-node` in-process on its own relay session (`forge-host-<uuid>`), and a browser is
reachable over WebRTC and nothing else. The only thing in that process that can make a WebRTC
connection is the webview sitting beside it, so the envelopes go out through the shell rather than
through a second Rust transport stack.

`ShellBridge` is that seam, a third sink after the native endpoint and before the relay:

```
engine -> DirectPlane::try_send  (iroh, a desktop seat)
       -> ShellBridge::try_send  (the webview, a browser seat)
       -> the relay              (everything else, always)
```

Four things cross it. Outward, an engine envelope for a seat and signalling addressed to the host.
Inward, the seats the webview currently reaches, signalling to send, and a seat's own envelope,
which takes the same route into the engine that a relay `StateUpdate` takes.

The relay session stays in the node. `ForgeHostBridge` in the webview runs a `WebRtcPlane` under
the node's username, so it reads itself as the room's host and every host rule applies unchanged,
but it never gets a relay session it could speak for the host with. Signalling arrives on the
node's socket, is forwarded out, and what the webview answers goes back and is sent under the
host's own attested identity.

The freeze lives in the node, not the webview. `ShellBridge::freeze_for_game` runs after the direct
plane has taken its seats and is given them, so no seat is claimed by two planes; the webview only
reports which channels are open and delivers what it is handed.

`ShellBridge::try_send` cannot know the send landed: the answer would have to come back across the
shell and the caller is the room's message loop. A seat whose channel dies in the window between
the webview's last report and that call loses envelopes. What repairs it is the debt the direct
plane already has: a seat that leaves this plane is owed a full board before it reads the relay
again, paid through `on_fallback` and cleared when it answers over the relay. A seat that leaves
does not come back for the rest of the game, in either direction.

A desktop host announces `kinds: ["iroh", "webrtc"]`, most preferred first, and a seat takes the
first of them it can speak. That is one roster serving both: its desktop seats land on iroh, its
browser seats on WebRTC.

### Not yet

Measured numbers from two real browsers, `RTCDataChannel` on WebKitGTK, and two machines on one
switch with the internet off, where Chromium replaces host candidates with mDNS names. See #838.

## Opting in

`MANABREW_DIRECT_TRANSPORT` is off by default. Off, the relay advertises neither `room_transport`
nor `peer_signal`, ignores `AnnounceTransport`, drops `SignalPeer`, and never sends a roster, so
every room behaves exactly as it does today. It fails closed, and a client that sees no
`peer_signal` never starts a negotiation that could not finish.

## Limits worth knowing before building on this

- **A browser cannot be direct over iroh.** iroh's `build.rs` sets `wasm_browser` for
  `wasm32-unknown-unknown`, and under that cfg the IP transports are compiled out. A browser
  endpoint has a real address and can host a room, but it cannot hole punch, so browser-to-browser
  over iroh is always relayed. It moves traffic off `manabrew-server`; it is not a latency win and
  it is not LAN. A direct data plane between browsers means WebRTC: see "The browser plane".
- **Transport is chosen before `GameStarted` and does not migrate mid-game.**
- **A superseded seat connection must be closed, not forgotten.** Dropping a `GameSender` is not
  enough: the receiver holds the same guard, so the old connection would keep feeding the engine
  responses under that seat's name. `GameSender::close` exists for this.
