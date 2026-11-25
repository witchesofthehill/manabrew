# Transport

Game traffic between the players in a room can go straight between peers over WebRTC instead of
through `manabrew-server`. The relay stays the rendezvous, the authority, and the fallback data
plane. Epic: #838.

## What moves

Only the engine envelopes: the host's `state`, `prompt`, `error`, `log`, `snapshot`, `fatal`,
and the seats' `Response` and `Directive`. An Ironsmith table also sends its per-seat `private`
payloads (transcript syncs, entries, heads, requests, answers) this way; see below. Everything
else stays on the relay: auth,
lobby, rooms, membership, `StartGame`/`GameStarted`/`EndGame`, reconnects, replay cache, analytics.

## Rules

- **The relay binds usernames to endpoints.** `AnnounceTransport` is recorded against the session;
  `RoomTransport` rosters and `PeerSignal.from` carry the relay's own record, never a client field.
- **A refused announcement is silent.** It counts in
  `manabrew_relay_transport_announcements_total{kind="rejected"}`.
- **Signalling is opaque and bounded.** The relay routes `SignalPeer` on username and drops
  anything over `MAX_SIGNAL_BYTES`.
- **Transport freezes at `GameStarted`** and never migrates mid-game, in either direction.
- **Fallback is a barrier.** A seat that leaves the plane owes a full board first
  (`SeatTransport::RelayPending`), cleared when it answers over the relay.
- **The host reports what left the relay** (`ReportTransport`), so the capture says what it misses.
- **A seat peers with the host only.** Exactly one end of a pair offers, decided by username order.
  Early ICE candidates are held, not dropped. A superseded connection is closed, not forgotten.
- **STUN, no TURN.** A seat that cannot be punched through stays on the relay. No relayed variant of
  `TRANSPORT_WEBRTC` exists.
- **A desktop host serves seats through its webview.** Rust cannot make a WebRTC connection, so
  `ShellBridge` is a second sink before the relay; the relay session and the freeze stay in the
  node. A headless node has no webview and offers no plane.

## Ironsmith

An Ironsmith table's traffic is `roomRelay` envelopes, not engine envelopes. Its `private`
payloads are each encrypted for one seat and go host to seat or seat to host, which is the plane's
star, so they ride it: `sendRoomMessage(message, { direct: true })` offers one to
`WebRtcPlane.trySendDirect` and sends it on the relay when the plane cannot carry it. The
`hello` key exchange, the host's public `state` and everything else stay on the relay.

- **A seat opts in per peer.** Its `hello` carries `direct: true`, and a sender goes direct only to a
  seat whose hello said so. A client from before this sent no such flag, and would ignore a message
  that arrived on a channel.
- **Large messages are chunked.** A channel refuses a message over its SCTP limit (262144 bytes in
  Chrome), and the match config alone is several times that. `trySendDirect` splits a message of
  250 000 bytes or more into numbered frames (`{ __chunk, i, n, d }`); the receiving plane rebuilds
  it, holds at most 8 unfinished messages per peer and drops one after 30 s. Only `trySendDirect`
  chunks: an ordinary `sendTo` still refuses an oversized message, so a peer that predates chunks is
  never handed one.
- **A room message names its sender.** A seat's plane delivers an engine envelope from the host with
  no sender, as before, but a `roomRelay` envelope with the host's username (and a host's, the seat's),
  because the runtime keys its encryption and its seats on that.
- **The relay path is the fallback and the repair.** A seat sends to the host only while its channel is
  open and the named recipient is the room's host; after a host change, or when a channel closes or
  fails, messages go over the relay. Messages on the two paths can cross, which the transcript's
  heartbeat (`head`, see `src/AGENTS.md`) repairs.

## Opting in

- **Deployment:** `MANABREW_DIRECT_TRANSPORT`, off in the binary, on in the production and staging
  compose files. Off, the relay advertises neither `room_transport` nor `peer_signal`.
- **Player:** "Peer to Peer" in Settings, off by default. Announcing is opting in. Ignored on a
  relay found on the local network: LAN tables stay on that relay for now.
- **Every player must opt in** (`Room::transport_consented`). Until then the roster goes out empty,
  which hangs up anything dialled earlier. Bots never count. Leaves and disconnects re-broadcast.
  `manabrew_relay_transport_rosters_total{kind="withheld"}` counts tables that did not upgrade.

## ICE servers

`MANABREW_ICE_SERVERS` on the relay: a comma-separated url list, or a JSON array of `RTCIceServer`.
`RoomTransport` carries them to every member. Without STUN a browser offers host candidates only
(Chromium rewrites them to mDNS names) and ICE never starts, so the compose files run a STUN-only
coturn (`--stun-only`, `network_mode: host` so the observed source address is not rewritten).
Production on UDP 3478, staging on 3479.

## Measured

| Case                                        | Result                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| Two home lines, different ISPs (2026-09-03) | `srflx/srflx`, 16ms on the channel vs 62ms via relay, 204ms to connect       |
| Cellular (carrier-grade NAT)                | signalling completes, ICE never connects, seat plays on the relay            |
| iCloud Private Relay                        | one proxied `srflx` candidate, no `host`; times out, seat plays on the relay |

The relay side is `manabrew_relay_peer_signals_total{kind}`; the client reports `ReportPlaneQuality`
once per attempt (`settled`) and again with the channel RTT (`measured`).

## Tests

`yarn test:networking` runs the relay rules against the real relay and node: fail closed, attested
and bounded signalling, one non-opted seat holding the table on the relay. `webrtcPlane.test.ts`
covers the send seam, offer ordering and a host serving each seat.
