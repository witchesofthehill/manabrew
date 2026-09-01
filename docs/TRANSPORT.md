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
- _What is room-scoped?_ The topic secret, and the relay token. Nothing else new.
- _Who may spend the deployment's relay bandwidth?_ `relay.manabrew.app` is a public hostname, and
  an iroh relay forwards for whoever dials it, so the relay is gated rather than open:
  `RoomMembersOnly` checks a room-scoped HMAC token the control plane mints and delivers in
  `RoomTransport`, which arrives before a client binds. The signing key is **generated per
  process**, never configured: the relay's `server_key` is published in `knownRelays.ts` and
  shipped to every browser, so signing with it would let anyone mint their own token. Nothing
  outside this process verifies a token, so nothing outside it needs the key, and a restart just
  means the next roster broadcast carries fresh ones.
- _And how much may they spend?_ `Limits::client_rx` caps a connection at 512 KB/s, because the
  relay shares a box with the game socket. It caps a **connection, not a client**:
  `accept_conn_limit` is unimplemented in iroh-relay 1.1, so one token holder can open many
  connections and pay the toll on each. What bounds that today is only the token being
  room-scoped and expiring in six hours.
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

**The browser build works.** `manabrew-net` compiles for `wasm32-unknown-unknown`, and
`manabrew-net-wasm` wraps it for JavaScript. It is a **separate module**, not part of the main
wasm bundle: iroh costs 3.0MB raw and 1.19MB gzipped, and a player who never joins a room that
offers a direct transport should not download it, so `src/game/directSeat.ts` imports it only
when `RoomTransport` arrives carrying a relay url. The module is genuinely optional, in both directions. `ring` compiles C for wasm32, so building
it needs a clang that can _target_ wasm32 — and Apple's clang, which is on every mac, cannot, so
`scripts/build-wasm.mjs` asks a candidate clang to compile for the target rather than trusting
that one exists. When none does it skips the module, and `vite.config.ts` then resolves
`@/wasm-net/net` to a stub that reports itself; `DirectSeat` catches the throw and the seat stays
on the relay. `src/types/wasmNet.d.ts` declares the module so `tsc` never needs the generated
files. That alias must sit **before** the `@` alias or the broader one claims the specifier.

A browser seat sends only its own answers over the channel (`response` and `directive`); a
browser _hosting_ a room still serves its seats over the relay. Hosting from the browser is the
next phase, and nothing in the design prevents it: the host role is the same `SeatTable` the node
runs.

None of this changes room semantics. A browser host is a `TransportEndpoint` like any other, and
its transport candidate list is simply "relay only", which the negotiation already handles.

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

### Two gates, and why they are not the same one

`self-hosted-node` and `manabot` both put the data plane behind a default-off cargo feature named
`iroh`. It is a build gate: without it neither crate pulls `manabrew-net`, so no QUIC stack, no
gossip and no second listening socket reach a binary that never asked for them. `manabot`'s
`native` feature used to imply `manabrew-net`, which meant every consumer of the bot got iroh
whether or not it wanted it. That is what the feature fixes.

`SELF_HOSTED_NODE_IROH` is the runtime gate, and it is the one the rollout uses. The fleet image is built
with the feature on precisely so enabling the transport on one node is an env change rather than a
new image; a compile-time rollout would make "one node, then the fleet" impossible, because the
fleet runs a single image. Dead code in a binary costs nothing. An open socket does, and that is
the one that stays shut.

So: `cargo build -p self-hosted-node` gives a relay-only node, `--features iroh` gives one that
can be switched on, and `SELF_HOSTED_NODE_IROH=1` decides whether it is. (`MANABREW_IROH_RELAY_URL`
and `MANABREW_IROH_RELAY_PORT` are the relay's own settings and a different thing.)

The transport seam is a channel pair rather than a `dyn` trait: `GameChannel` owns an outbound
`mpsc::Sender`, an inbound `mpsc::Receiver` and a `watch` of `TransportStatus`. A transport is
whatever task pumps that pair. `IrohChannel` is one such task; the existing relay WebSocket loop
is the other, and it needs no rewrite to qualify.

## Observability

**The relay only records what it carries, so the host says what it took away.** Most telemetry
is unaffected, and it is worth being precise about which:

| Signal                                                                | Source                                                   | Affected |
| --------------------------------------------------------------------- | -------------------------------------------------------- | -------- |
| `games`, `game_players`, `GameStarted`/`GameEnded`, deck play reports | control-plane messages                                   | no       |
| `manabrew_node_forge_decision_seconds`, engine GC/heap/stall          | the node, per decision                                   | no       |
| `AnalyticsEvent::EngineStats`                                         | the seat, over `ReportEngineStats` on the control socket | no       |
| relay game capture (`MANABREW_GAME_CAPTURE_DIR`)                      | the envelope stream                                      | **yes**  |
| relay replay cache                                                    | the envelope stream                                      | **yes**  |

Only the two that read the stream lose anything, and the danger there is not the missing bytes
but the silence: a capture file that quietly omits a seat produces wrong latency conclusions,
while one that says which seat left is still usable. So the host reports it. At `GameStarted`
the engine host sends `ClientMessage::ReportTransport` naming every seat that is about to leave
the relay, the relay writes it into that game's capture as a line and emits
`AnalyticsEvent::TransportUsed`, and a reader can see exactly what the file cannot show. This is
the same seam `ReportEngineStats` uses, and the same principle offline play already runs on: the
party that did the work reports it, and the relay is a route rather than the source of truth.

**Falling back is a state machine, not a switch.** A seat whose direct channel died has a board
the relay never saw, so it cannot simply resume relay traffic:

```
direct dies -> RelayPending -> full authoritative seat state over the relay
            -> seat answers over the relay -> Relay
```

`RelayPending` is a debt the host owes that seat, and it is paid before anything else for that
seat goes out: the re-prime is queued inside `drop_seat`, which runs before `try_send` returns
false to its caller, and `outbound_tx` is ordered. What it sends is the seat's last **full** state
and pending prompt, the values stored before `patch_against_last` runs, which is what lets them
rebuild a cache that missed everything in between. Without it a later `stateDelta` patch would be
folded onto a base the relay never held.

The acknowledgement is the seat's own next envelope over the relay. It needs no new message and
it proves the thing that matters, which is that the seat is reading that path again. A seat that
never went direct has no state here at all.

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

**Nothing binds against a relay url, ever.** A host and a seat both bind relay-less and take the
relay the control plane names in `RoomTransport` (`NetEndpoint::adopt_relay`), because our relay
admits nobody without a room token and a token only exists once there is a room to mint it for.
Binding against a configured url would produce an endpoint that advertises a relay it is refused
by, reachable by nobody. `SELF_HOSTED_NODE_IROH_RELAY_URL` is only the fallback for a relay too
old to name one, and against a gated relay it will be refused. The first adoption changes the
endpoint's address, so it announces itself again.

Adoption runs on **every** `RoomTransport`, not just the first. A token lives six hours and a
room outlives games, so a node hosting for longer would have its next relay reconnect refused and
its seats would fall back saying nothing. `insert_relay` replacing the config is the renewal, so
re-adopting is all it takes; only the first one returns true and triggers an announcement.

That adoption is why an endpoint with no relay binds with an **empty relay map** rather than
`RelayMode::Disabled`. Both mean "no relay for now", but `Disabled` builds no relay transport, so
a relay inserted later has nothing to run it. `relayed.rs` pins the whole sequence.

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
- **Phase 3 (done).** The deployment's own iroh relay, hosted by `manabrew-server`, and
  replay-cache re-priming on fallback. Production runs the relay from the next deploy
  (`MANABREW_IROH_RELAY_PORT`, `handle /relay*` on `relay.manabrew.app`, which the deploy's own
  ingress reload applies). **Running it is not the same as moving traffic onto it:** the fleet
  keeps `SELF_HOSTED_NODE_IROH` off, so what it serves is the fallback for hosts that do offer a
  direct plane. What is left here is live migration at a resync boundary, which is optional:
  transport is chosen before `GameStarted` and never changes mid-game, and the fallback direction
  is already a barrier rather than a switch.
- **Phase 4 (partly done).** The browser seat: `manabrew-net-wasm`, the lazily-imported module,
  and the client wiring. What is **not** verified is a real browser game over it, because that
  needs a browser; the Rust and TypeScript both build and lint, and the relay-only path is
  covered natively by `manabrew-net/tests/relayed.rs`, which uses an endpoint with its IP
  transports cleared. Still open: browser-_hosted_ rooms, and a desktop-embedded relay, which is
  still not worth it.
