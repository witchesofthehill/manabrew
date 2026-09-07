# Transport

Game traffic between players in a room goes through `manabrew-server`, which makes two WAN hops
out of what is often one network. This is the seam that lets it go straight between peers
instead.

Every seat takes the same direct transport: WebRTC. A browser drives it, and a desktop drives it
from the webview beside its engine. One rendezvous sits behind it. #838.

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

The relay is the authority that binds a username to an endpoint. Nothing else is.

1. A member announces a WebRTC endpoint with `ClientMessage::AnnounceTransport`.
2. The relay records it against that session's player id and rebroadcasts
   `ServerMessage::RoomTransport` to the room: the host, and every member's endpoint, each named
   with the relay's own record of who that session is. A username in the roster is never a
   client-supplied field.
3. A seat offers to the host the roster names. The offer, the answer and the ICE candidates all
   cross the relay, stamped with the sender's attested name. A name claimed in the payload is worth
   nothing; the relay's `from` is what a connection is keyed on.

An announcement is refused, silently, if the announcer is not in the room or if another member
already claimed that endpoint; the announcer stays on the relay and
`manabrew_relay_transport_announcements_total{kind="rejected"}` is where it shows up. Silence is
deliberate: a squatter must not be able to make a real player see an error about a room they are
sitting in.

## The host

`self-hosted-node` is the engine host, on the fleet and in-process in a desktop app under the
`forge-room` feature. A desktop host cannot make a WebRTC connection from its Rust process, so the
webview beside it holds those connections and the engine's envelopes for a seat go out through the
shell rather than through a second transport stack.

A seat is chosen for the plane at `GameStarted` and never migrates mid-game, in either direction.
A seat whose channel dies goes back to the relay, but not silently: while it was direct the relay
saw none of its envelopes, so the host owes it a full state before anything else goes out.
`SeatTransport::RelayPending` is that debt, paid through `on_fallback` into the ordered outbound
queue, and cleared when the seat answers over the relay, which is the only signal that it is
reading that path again.

The relay cannot observe traffic it does not carry, so the host tells it: `ReportTransport` names
the seats that left, and the relay writes that into the game's capture. Without it a capture file
is silently incomplete and whoever reads it later measures a game they cannot see all of.

## The browser plane

`WebRtcPlane` holds one `RTCPeerConnection` per peer and one reliable ordered `RTCDataChannel` on
each, carrying the same engine envelope set. A seat connects to the host and to nobody else,
because that is the only edge envelopes cross. A desktop seat runs the very same plane in its
webview; nothing about it is browser-specific except that a browser is where `RTCPeerConnection`
lives.

The relay carries the offer, the answer and the ICE candidates, and stops there.
`ClientMessage::SignalPeer` names a room member by username; the relay does not read the payload,
routes on the name, stamps `from` from its own record of the sending session and forwards
`ServerMessage::PeerSignal`. That is the attestation `RoomTransport` already gives the roster,
applied to signalling. A blob over `MAX_SIGNAL_BYTES` is dropped, because an opaque payload's size
is the only thing the relay can judge it on and the control plane must not become a data plane.

Somebody has to announce first. The relay sends a roster only once a member has announced, and a
seat ignores a roster until one names a host, so a room where nobody announces unprompted never
starts a plane at all. A node-hosted room does not have the problem: `self-hosted-node` announces
at startup. A browser-hosted one has no node, so a seat announces its endpoint on entering a room
rather than in response to a roster it would be waiting on forever. That is safe: a WebRTC endpoint
is a name, not a bound socket, and the addresses cross later over signalling, so announcing one for
a room that turns out to stay on the relay costs nothing.

Two rules keep the plane simple:

- **Peers are addressed by username, never by peer type.** A desktop seat and a browser seat use
  the same signalling path.
- **The send seam takes a second sink rather than a rewrite.** `trySend` returns false and the
  caller puts the envelope on the relay.

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
to every member, so no client hardcodes one and a deployment answers the
question by configuring its relay rather than by shipping new clients. A comma
separated url list covers STUN; a JSON array of `RTCIceServer` covers TURN,
which needs a username and a credential. Unparseable config yields no servers
rather than a refusal to start, because a relay that will not boot serves
nobody.

### Running the STUN server

`compose.staging.yml` carries a STUN-only coturn, and points
`MANABREW_ICE_SERVERS` at it. The two go together: naming a STUN server that is
not answering is worse than naming none, because ICE gathering waits out the
timeout and then produces the same host-only candidates anyway. A client handed
none says so in its console.

No firewall rule was needed. Measured on the box on 2026-09-02: `ufw` is
inactive, `iptables -P INPUT ACCEPT`, and nothing else there binds a UDP port.
A STUN binding request sent from another network reached it on the first
attempt and came back in 67ms carrying the right XOR-MAPPED-ADDRESS, which also
rules out a cloud firewall in front of the host. Should one ever appear, UDP
3478 is the port to allow.

`network_mode: host` on that container is load-bearing, not a shortcut. A STUN
server answers with the source address it observed, so anything that rewrites
the client's source on the way in makes it answer with that address instead,
and every peer is handed one no other peer can reach. Publishing a port through
the docker proxy does exactly that.

`--stun-only` makes it refuse allocation requests, so it cannot become a data
path by accident or because somebody else pointed a client at it.

### Measured

Browser to browser, two ordinary home lines on different ISPs, 2026-09-03:

```
[webrtc] peer=... outcome=connected connect=204ms relayRtt=62ms
[webrtc] peer=... outcome=connected rtt=16ms pair=srflx/srflx relayRtt=62ms
```

16ms on the data channel against 62ms through the relay, so the plane is worth
having: 46ms off every round trip, and a prompt-and-response is a round trip.
`srflx/srflx` means it hole punched, with STUN alone and no TURN. Connect took
204ms, which is nothing against the `GameStarted` barrier.

One pair is not a connect rate. What it settles is that the mechanism works and
the win is real; how often a pair can be punched needs many pairs.

### iCloud Private Relay defeats it

Worth knowing before reading a failure as a NAT problem. With Private Relay on,
an iOS seat contributes exactly one candidate and no host candidate:

```
remote: candidate:... 146.75.186.18 21724 typ srflx
```

That address belongs to Fastly, and on an earlier attempt it was Cloudflare.
Those are Private Relay's egress providers, and the provider changing between
attempts is the giveaway: a home ISP does not do that. A proxied reflexive
address is not a NAT binding the phone can receive punch traffic on, so the one
pair ICE can form only times out. Turning Private Relay off produced the numbers
above on the same two networks.

`local=host+srflx remote=srflx` with no remote `host` is the fingerprint. The
seat falls back to the relay and plays, so this costs nothing but the upgrade.

### What cellular settles

Measured 2026-09-03, browser at home to iOS Safari on cellular, two networks:
announcement and signalling completed (2 announcements, 8 signals forwarded and
attested), ICE did not connect, the seat fell back to the relay and the game
carried on.

Cellular is behind carrier-grade NAT, which is symmetric, and symmetric NAT
cannot be punched through with STUN. Firefox says as much: "add a TURN server".

The connect deadline was not the cause, in that run or the Private Relay ones.
Firefox fails a pair on its own once its 5s trickle grace period elapses with
every pair failed, well inside any deadline this client sets.

It is not an argument for running one. TURN would carry that seat's traffic
through a server, which is two hops, which is what the relay already does at a
measured 55ms. The epic rejected a relay bridge because it is "the same two
hops, so it is not a peer-to-peer win", and TURN is that bridge with the
traversal unused. A cellular seat on the relay has lost nothing it had; a
cellular seat on TURN gains nothing except a second data plane to maintain.

So the rule this measurement establishes: a seat behind carrier-grade NAT stays
on the relay, by design and permanently. The browser plane is for pairs that can
be punched through, which is where the win exists.

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
plane has to beat. Measurement continues through the game, not only at connect, so a path that
degrades mid-game is visible.

`manabrew_relay_peer_signals_total{kind}` counts what the relay did with each signal: forwarded, or
why not. A negotiation that never completes shows up there, because a dropped signal is answered
with silence the same way a rejected announcement is.

### A desktop host serving a seat

A desktop host cannot dial a seat from its Rust process. Its engine is `self-hosted-node`
in-process on its own relay session (`forge-host-<uuid>`), and the only thing in that process that
can make a WebRTC connection is the webview sitting beside it, so the envelopes go out through the
shell.

`ShellBridge` is that seam, a second sink before the relay:

```
engine -> ShellBridge::try_send  (the webview, a WebRTC seat)
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

The freeze lives in the node, not the webview. `ShellBridge::freeze_for_game` runs on the seats the
roster names and the webview is given them, so no seat is claimed twice; the webview only reports
which channels are open and delivers what it is handed.

`ShellBridge::try_send` cannot know the send landed: the answer would have to come back across the
shell and the caller is the room's message loop. A seat whose channel dies in the window between
the webview's last report and that call loses envelopes. What repairs it is the debt above: a seat
that leaves this plane is owed a full board before it reads the relay again, paid through
`on_fallback` and cleared when it answers over the relay. A seat that leaves does not come back for
the rest of the game, in either direction.

## Opting in

Two switches, one per side.

**The deployment's.** `MANABREW_DIRECT_TRANSPORT` is off by default in the relay binary and on
in `compose.production.yml` and `compose.staging.yml`. Off, the relay advertises neither
`room_transport` nor `peer_signal`, ignores `AnnounceTransport`, drops `SignalPeer`, and never
sends a roster, so every room behaves exactly as it did before. It fails closed, and a client
that sees no `peer_signal` never starts a negotiation that could not finish.

**The player's.** "Peer to Peer" in Settings, off by default. It is ignored on a relay found on the
local network: a LAN table stays on that relay for now, whatever the players chose. Announcing an endpoint is
how a player opts in: a client with the setting off announces nothing, dials nobody, and tears
down any plane a roster offers it. A desktop that hosts a room with it off gets no shell bridge,
so it announces nothing either.

**The room upgrades only when every player in it opted in.** The relay enforces this
(`Room::transport_consented`): a roster with a host and members goes out only once every human
seat has announced; until then, and again the moment a seat that has not announced sits down or
one withdraws, the roster goes out empty. Bots never announce and never count. An empty roster
is a message, not an absence: a seat that dialled earlier hangs up on it (`WebRtcPlane.onRoster`),
and the host freezes only seats the current roster names (`ShellBridge::freeze_for_game`), so a
connection left over from before the objector arrived cannot carry a game. A player leaving or
disconnecting re-broadcasts the roster, because the leaver may have been the one holding the table
back.

`manabrew_relay_transport_rosters_total{kind="withheld"}` beside `{kind="sent"}` says how often a
table wanted the plane and did not get it.

The networking regression (`yarn test:networking`) plays the relay's rules against the real relay
and a real node: the flag failing closed, signalling attested and bounded by the relay, and a room
held on the relay by one seat that never announced. The `WebRtcPlane` unit suite
(`webrtcPlane.test.ts`) covers the send seam, offer ordering, and a host serving each seat over its
own channel.

## Limits worth knowing before building on this

- **Transport is chosen before `GameStarted` and does not migrate mid-game.**
- **A seat behind carrier-grade NAT or iCloud Private Relay stays on the relay**, by design: STUN
  cannot punch a symmetric NAT and there is no TURN. See "What cellular settles".
- **A superseded seat connection must be closed, not forgotten.** A stale `RTCPeerConnection` left
  open would keep feeding the engine responses under that seat's name; `WebRtcPlane` closes the
  peer it replaces.
