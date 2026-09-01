# Transport

Game traffic between players in a room goes through `manabrew-server`, which makes two WAN hops
out of what is often one network. This is the seam that lets it go straight between peers
instead.

Only native peers can be direct. A browser cannot hole punch, so browser-only rooms want WebRTC
instead: #838.

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

## Opting in

`MANABREW_DIRECT_TRANSPORT` is off by default. Off, the relay does not advertise the
`room_transport` feature, ignores `AnnounceTransport`, and never sends a roster, so every room
behaves exactly as it does today. It fails closed.

## Limits worth knowing before building on this

- **A browser cannot be direct.** iroh's `build.rs` sets `wasm_browser` for
  `wasm32-unknown-unknown`, and under that cfg the IP transports are compiled out. A browser
  endpoint has a real address and can host a room, but it cannot hole punch, so browser-to-browser
  over iroh is always relayed. It moves traffic off `manabrew-server`; it is not a latency win and
  it is not LAN. A direct data plane between browsers means WebRTC, which is a different
  implementation behind this same rendezvous.
- **Transport is chosen before `GameStarted` and does not migrate mid-game.**
- **A superseded seat connection must be closed, not forgotten.** Dropping a `GameSender` is not
  enough: the receiver holds the same guard, so the old connection would keep feeding the engine
  responses under that seat's name. `GameSender::close` exists for this.
