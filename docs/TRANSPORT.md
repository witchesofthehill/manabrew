# Transport architecture

Manabrew rooms are logical authenticated sessions. The relay (`manabrew-server`) is the trusted
control and rendezvous plane. The data plane should use the best transport both ends can reach.
A LAN game is not a mode; it is what direct connectivity looks like when the peers happen to
share a subnet.

Status: phase 1 (primitives and control plane) is implemented. Production game traffic still
runs over the relay. See "Staging" at the end.

## Where a game is authoritative today

| Host                   | Engine                               | Process            | Relay client           |
| ---------------------- | ------------------------------------ | ------------------ | ---------------------- |
| Hosted Forge worker    | Forge (GraalVM native)               | `self-hosted-node` | Rust, native           |
| Desktop room           | Forge via bundled `self-hosted-node` | Tauri sidecar      | Rust, native           |
| Browser or desktop tab | Manabrew wasm, or Forge-wasm         | web worker         | JavaScript `WebSocket` |
| Offline                | same as above                        | web worker         | none                   |

Every one of these speaks the same envelopes. The host emits `state`, `display`, `prompt`,
`error`, `log`, `snapshot`, `fatal`; seats reply with `Response` and `Directive`. They travel
today inside `ClientMessage::BroadcastState` and come back as `ServerMessage::StateUpdate`.
The relay routes on `target_player` and never reads the payload, except to diff `state` for
`stateDelta` patches.

That envelope set is the whole data plane. It is what moves off the relay.

## Roles

**No public infrastructure.** Manabrew runs its own iroh relay and its own address
distribution. The endpoint is built from `presets::Minimal`, never `presets::N0`: no pkarr
publisher, no n0 DNS, no n0 relay list. `NetConfig`'s relay mode defaults to
`RelayMode::Disabled`, so a misconfiguration produces a direct-only endpoint rather than one
quietly talking to somebody else's servers. The relay url reaches clients from the control
plane (`RoomTransport.iroh_relay_url`, from `MANABREW_IROH_RELAY_URL` on `manabrew-server`), so
no client hardcodes one and rotating it is a server config change.

**Relay (control plane).** Keeps everything it owns today: authentication and identity proofs,
the lobby, room creation and discovery, membership, readiness, deck selection, engine selection,
`StartGame`/`GameStarted`/`EndGame`, the reconnect window and seat forfeits, the replay cache,
analytics. It gains one job: it is the authority that binds a relay username to an iroh
endpoint id, and it hands each room its gossip topic secret. It also remains a working data
plane, forever, as the fallback.

**Direct iroh QUIC (data plane).** One bidirectional stream per seat between that seat and the
authoritative host. Carries the envelope set above. Reliable and ordered, which the game needs:
prompts are request/response, and per-seat `state` and `prompt` envelopes contain hidden
information that must not reach other seats.

**iroh-gossip (room-local coordination).** Presence, endpoint announcement and re-announcement,
host announcement, topology and transport-health notices. Never game state. Two reasons, both
hard: a gossip topic is a broadcast tree with no per-recipient addressing, so any per-seat
envelope published on it leaks hidden information to every subscriber; and gossip gives no
ordering or delivery guarantee, which a prompt/response protocol needs.

iroh-gossip earns its place for a second reason that is easy to miss. Its `GossipAddressLookup`
feeds addressing information learned from Join and ForwardJoin messages back into the endpoint's
address book. Subscribing to the room topic is therefore also how peers keep each other's
`EndpointAddr` fresh across network changes, without a relay round trip.

## Topology

```
                       manabrew-server
              identity / rendezvous / fallback
                       /     |     \
                      /      |      \
            hosted Forge  desktop   browser
                node        host    Forge-wasm
                  \          |         /
                   \_________|________/
                     iroh: direct, or
                     iroh-relayed, or
                     manabrew-server
```

The joining player sees a room with an authenticated host and a negotiated transport. Nothing
above the transport seam knows which arm of the diagram the host sits on.

## Security model

Two independent facts compose, and neither is a new identity system.

1. **The relay says who owns an endpoint id.** A session is already authenticated
   (`docs/agents/RELAY.md`). `AnnounceTransport` is accepted only from an authenticated session
   that is in the room, and the relay tags the announcement with _its_ view of that session's
   username. Clients learn the roster only from `ServerMessage::RoomTransport`, over the
   authenticated WebSocket. A client never trusts an endpoint id learned from gossip alone.
2. **iroh proves you are talking to that endpoint id.** iroh QUIC has no server certificate
   chain. Each endpoint is its ed25519 key, and the handshake authenticates it. `remote_id()`
   on an accepted connection is proof, not a claim.

So the host's admission check is one comparison: the connecting `remote_id()` must equal the
endpoint id the relay attested for the username in the `Hello` frame. No capability token is
needed for the game stream, and there is no second secret to leak or rotate.

**Gossip authorship must be signed.** `iroh_gossip::api::Message::delivered_from` is the
forwarding neighbour, not the author. Room announcements are therefore signed with the
announcer's iroh secret key and verified against the announced endpoint id, and then against
the relay-attested roster. An unsigned or unattested announcement is dropped.

**Topic admission.** The gossip `TopicId` is derived as
`blake3(domain || room_id || topic_secret)`. The 32-byte `topic_secret` is minted per room and
sent only to authenticated room members. Knowing a room id is not enough to find the topic.
The topic secret is not rotated on membership change: the roster check, not topic secrecy, is
what stops an ex-member from being believed. Presence traffic carries usernames and endpoint
ids, which the lobby already publishes to everyone.

Answers to the questions this raises:

- _How does a client know an endpoint belongs to the player it claims?_ The relay said so, over
  an authenticated channel, and QUIC proved the key.
- _How is the authoritative host identified?_ `RoomTransport.host`, derived from
  `Room::host_player_id`, which the relay already owns and already reassigns.
- _Can a random peer join the topic or dial the host?_ They can dial if they learn the endpoint
  id, and the host will reject them at `Hello`. They cannot derive the topic id without the
  room secret.
- _What is room-scoped?_ The topic secret. Nothing else new.
- _Host replacement or reconnect?_ The relay updates `host_player_id` and rebroadcasts
  `RoomTransport`. Peers re-dial. A returning browser host proves the same relay identity it
  had before, announces a new endpoint id, and the roster updates. The endpoint key is
  ephemeral by design, so nothing is lost when a tab closes.

## Fallback and migration

Phase 1 chooses a transport before the game starts and does not migrate mid-game:

1. Join and authenticate the room over the relay, as today.
2. Receive `RoomTransport`: topic secret, host, roster.
3. Derive the topic, subscribe, announce presence.
4. Dial the host over iroh.
5. On success, use the direct channel. On failure or timeout, stay on the relay.

If a direct channel dies mid-game the seat falls back to the relay and issues the existing
`RequestResync`, which already replays `GameStarted` plus that seat's last state and pending
prompt. That is why phase 1 does not need sequence numbers in the relay protocol: the existing
resync path is the recovery mechanism. `SessionFrame` carries a `seq` so that a later phase can
replace resync with a cheap barrier handshake.

Hazards and how they are handled:

- _Duplicate delivery._ One transport is authoritative per seat at a time. The host stops
  writing a seat's envelopes to the relay the moment it accepts that seat's direct stream.
- _Ordering._ Guaranteed within one QUIC stream. Switching transports is only allowed at a
  resync boundary.
- _Stale peers._ Presence announcements carry a monotonic `seq` and a timestamp; a lower `seq`
  for a known endpoint is ignored, and peers are expired after `PRESENCE_TTL`.
- _Split brain._ There is exactly one authoritative host and the relay names it. A peer that
  believes in a different host has an outdated roster and will be rejected at `Hello`.
- _Malicious endpoint advertisement._ Covered above: gossip is never a source of authority.
- _Players joining or leaving mid-game._ Unchanged; the relay drives it and rebroadcasts
  `RoomTransport`.

## The browser

iroh compiles to `wasm32-unknown-unknown` and the endpoint works there, but only over relays.
This was verified against iroh 1.1.0 sources, not from memory:

- `build.rs` defines `wasm_browser = all(target_family = "wasm", target_os = "unknown")`.
- Under that cfg the IP transports are compiled out. `Transports::local_addrs_watch` yields
  only relay and custom addresses.
- A browser endpoint therefore has a real `EndpointAddr` (its home relay plus its id), so it
  **can accept incoming connections** and can host a room. It cannot hole punch.
- Not available in the browser: `dns`, `BindOpts`, `portmapper`, net report probes.

Consequences for us:

- Browser to browser over iroh is relayed by an iroh relay. It moves traffic off
  `manabrew-server` but it is not a latency win and it is not LAN.
- Browser to desktop is also relayed, for the same reason.
- The relay a browser uses is ours. `iroh-relay` ships a server binary (`cargo install
iroh-relay --features server`, TOML config, `cert_mode = "LetsEncrypt"` or `"Manual"` against
  the certificates already on the box). Run it on the prod host as `relay.manabrew.app` and set
  `MANABREW_IROH_RELAY_URL`. Give it its own listener rather than a path on the existing Caddy
  site: native clients upgrade the HTTP connection to a bespoke TCP protocol, which a generic
  reverse proxy is not guaranteed to pass through, and touching the prod Caddyfile means an
  edge reload, which kills live games.
- A _desktop_-hosted iroh relay is a different question and the answer is no, for now.
  `iroh-relay` can serve without TLS, so a desktop could run one on the LAN for native peers.
  Browsers cannot use it: a page served from `https://play.manabrew.app` may not open
  `ws://192.168.x.x`, and mixed content blocking has no workaround short of a real certificate
  for a private address. `ws://localhost` is exempt, which only helps the machine already
  running the app. So an embedded desktop relay is phase 4 at best, and it sits behind the same
  `TransportEndpoint` seam either way.

Two build constraints found while checking this, both real:

- iroh 1.1 is edition 2024 and needs rustc >= 1.91. The repo's default toolchain here is
  1.88.0; `origin/main` already needs 1.94.1 for other reasons.
- `ring` compiles C for `wasm32-unknown-unknown`. Apple clang cannot target wasm, so a browser
  build of iroh needs an LLVM clang on the path, locally and in CI. This is the reason the wasm
  half is not in phase 1.

None of this changes room semantics. A browser host is a `TransportEndpoint` like any other,
and until the wasm build lands its transport candidate list is simply "relay only", which the
negotiation already handles.

## Code map

| Path                                                    | Role                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| `manabrew-rs/crates/manabrew-net/`                      | endpoint lifecycle, session frames, direct channel, room gossip |
| `manabrew-rs/crates/manabrew-relay-protocol/src/lib.rs` | `TransportEndpoint`, `AnnounceTransport`, `RoomTransport`       |
| `manabrew-rs/crates/manabrew-server/src/room.rs`        | per-room transport roster and topic secret                      |
| `manabrew-rs/crates/manabrew-server/src/connection.rs`  | announcement authorization and roster broadcast                 |
| `manabrew-rs/crates/manabrew-server/src/config.rs`      | `MANABREW_IROH_RELAY_URL`                                       |

`AnnounceTransport` is gated behind `FEATURE_ROOM_TRANSPORT` in `AuthResult.features`: an older
relay answers an unknown client message with an error, and the client turns relay errors into
toasts, so a client must not send it blind.

`manabrew-relay-protocol` does not depend on iroh. The wire carries strings, so the control
plane stays transport agnostic and the same messages work for a future non-iroh transport.

The transport seam is a channel pair rather than a `dyn` trait: `GameChannel` owns an outbound
`mpsc::Sender`, an inbound `mpsc::Receiver` and a `watch` of `TransportStatus`. A transport is
whatever task pumps that pair. `IrohChannel` is one such task; the existing relay WebSocket loop
is the other, and it needs no rewrite to qualify.

## Observability

**The relay only records what it carries.** A seat on the direct plane is missing from the
relay's game capture and from its replay cache, so a captured hosted game covers the seats that
stayed on the relay and no others, and a resync for a direct seat returns the last board the
relay saw until the next relayed envelope corrects it. Anyone reading capture files for latency
work (`docs/agents/LATENCY_ANALYSIS.md`) needs to know which seats were direct. This is why the
flag is off in production.

`TransportStatus` reports, per seat: attempted, connected or failed; `TransportKind` of
`Relay`, `IrohDirect` or `IrohRelayed`; whether the selected path's remote address is
RFC1918/link-local (`lan: bool`); the relay url in use; RTT; setup latency; reconnect count;
and a failure reason. `Connection::paths()` supplies direct-versus-relay and RTT;
`Connection::path_events()` supplies the transitions. Gossip peer count and endpoint churn come
from `GossipTopic::neighbors()` and the presence table.

## Addressing

Peers never look each other up. `connect_to_host` dials a full `EndpointAddr` taken straight
from the roster. Gossip dials by endpoint id alone, so the roster is also loaded into an
`iroh::address_lookup::memory::MemoryLookup` on the endpoint, which is the only address source
configured. That keeps the control plane the single origin of addressing and means nothing is
published to a third-party DNS or DHT.

## Manual test, two machines on one LAN

Phase 1 exercises the primitives, not production game traffic, so this checks the transport
itself:

1. `cargo test -p manabrew-net` on one machine. `attested_seat_gets_a_direct_channel` asserts a
   direct path with no relay configured at all.
2. On two machines on the same subnet, run the two halves of `tests/direct.rs` with the
   endpoints' `TransportEndpoint` values pasted between them (they contain the LAN addresses).
   Expect `TransportKind::IrohDirect` and `lan: true` on both sides, and an RTT in single-digit
   milliseconds.
3. Start `manabrew-server` with `MANABREW_IROH_RELAY_URL` unset, join a room from two clients,
   and confirm `RoomTransport` arrives on both with the same `topic_secret` and a `members`
   entry per announced peer. Confirm a third client outside the room never receives it.
4. `manabrew_relay_transport_announcements_total` on `/metrics` increments per announcement and
   per withdrawal.

## Staging

- **Phase 1 (this change).** Transport abstraction, iroh endpoint lifecycle, room-scoped
  endpoint metadata on the relay, gossip topic and signed presence, authenticated bootstrap,
  status reporting. No production game traffic moves.
- **Phase 2 (done).** Seat to hosted-Forge-node traffic over iroh. `self-hosted-node` binds an
  endpoint per room, announces it, installs the roster, joins the gossip topic, and accepts seat
  streams; per-seat envelopes for a connected seat leave over QUIC instead of `BroadcastState`.
  Gated on `SELF_HOSTED_NODE_IROH=1`, on for staging and off in production. The seat set is
  frozen at `GameStarted` and any failure falls back to the relay. `manabot` is the first seat
  that dials, which is what puts real games on the direct plane on the preview.
  See `docs/agents/SELF_HOSTED_NODE.md`.
- **Phase 3.** Re-prime the relay's replay cache when a seat falls back (a resync is currently
  one envelope stale for a seat that was direct), reconnect hardening, and live migration at a
  resync boundary. Then the client half, so a real player seat can take the direct plane.
- **Phase 4.** The wasm build (LLVM clang in CI, bundle budget) and, only if justified, an
  embedded relay.
