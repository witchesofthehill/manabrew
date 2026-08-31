# The relay (`manabrew-rs/crates/manabrew-server`)

Standalone matchmaking/lobby server. Optional — the app plays offline and self-hosted without it.

## Trust boundary

The relay is the multiplayer trust boundary. Only the room's engine host may emit engine-output envelopes (`State`, `Display`, `Prompt`, `Error`, `Log`, `Snapshot`, `Fatal`); player `Response` and `Directive` envelopes are routed only to that host after the authenticated relay username is matched against the claimed `fromPlayer` engine slot. Replay mutation happens only after this authorization. Inputs are retained with their authenticated sender until subsequent engine output acknowledges delivery, so host reconnect replay is intentionally at-least-once; prompt ID validation rejects duplicate responses and concede directives are idempotent.

**The authorization check strictly deserializes every player envelope as `ClientToServerMessage` (`connection.rs`) and silently drops anything that fails to parse — no error reaches the sender — so a `manabrew-protocol`/`manabrew-relay-protocol` change (new output variant, new field without a default) dead-ends at a stale relay with zero symptoms.** A protocol change must reach every hop: relay, node/Tauri binaries, harness jar, wasm bundle. The `compose.dev.yaml` relay live-rebuilds via watchexec on the bind-mounted `manabrew-protocol`/`manabrew-relay-protocol`/`manabrew-server` sources — confirm with `docker logs -t manabrew-relay-1` that a rebuild ran after your edit rather than assuming the mount delivered the file event.

## Privacy

Per-seat `State`, `Prompt`, and `Error` envelopes can contain hidden information. A hosted node must set `BroadcastState.target_player` for all three; `forPlayer` inside the envelope is for client dispatch and replay indexing, not transport privacy.

## Replay cache and resync

In-game state is cached per room (`replay.rs`) so reconnecting clients can pull a `RequestResync` replay: GameStarted + the reconnecting seat's last state + its pending prompt. States arrive per-seat via `BroadcastState.target_player` — an address the relay routes on without reading `state` — and are cached per slot with an untargeted public fallback for observers. The room's `reconnect_timeout_s` is clamped ≤ 90s to stay under the engine's 120s auto-pass (`manabrew-game-runtime/src/mpsc_transport.rs`).

## Restart survival

Rooms survive relay restarts: `RoomCreated` returns a random `resume_token` (guards live rooms; a forgotten room is resurrected on first `ResumeRoom` claim after a restart), the host re-registers and re-primes the replay cache, and guests — humans and bots alike — retake their in-game seat by username through `JoinRoom` (resurrected bot seats start disconnected until the bot rejoins). Every game gets a relay-generated `game_id` (broadcast in `GameStarted`, preserved across restarts via `ResumeRoom`) — the identity hosted nodes reconcile their engine sessions against.

## Reconnect window and cleanup

The relay is the single owner of the reconnect window: a disconnected in-game seat is forfeited (removed + broadcast like a leave) once its grace expires (`schedule_seat_forfeit`), so hosts never time disconnects themselves. A non-playing host disconnect gets the same reconnect grace as players instead of killing the room. The cleanup sweep resets any in-game room that has had no connected human participant (bot seats and the hosted node's observer don't count) for `reconnect_timeout_s` + margin back to Lobby — otherwise abandoned hosted games would sit `InGame` forever and skew the live-ops gauges. Room teardown funnels through exactly two primitives — `reset_room_to_lobby` (room survives) and `remove_room_and_clear_sessions` (room dies) — sharing one session rule: disconnected sessions are removed with the room, connected ones return to the lobby; never inline a third copy.

## Identity and usernames

`Authenticate` carries an optional identity proof (`identity.rs`): a hub-minted EdDSA token verified against `MANABREW_HUB_JWKS_URL`, and/or an opaque client device secret stored as its sha256. The session keeps every identity it resolves; a connection proving one of them takes its own live session over (the displaced socket gets `SessionTakenOver`, then a close; the `generation` guard makes its later cleanup a no-op), and a session that has an identity can only be reclaimed by that owner.

The session's name is the token's `handle` claim, nothing else (`manabrew-relay-protocol/src/identity_token.rs` defines the token). A hub-signed token (EdDSA, `iss manabrew-hub`) makes the name `name_verified`; a self-minted unsigned token (`alg none`, `iss manabrew-client`, empty signature) is accepted with the name unverified, so the Hub is never a hard dependency for connecting. Every current client sends a token — the web client falls back to self-minting when the Hub is unreachable, and the hosted node and manabot self-mint theirs — so the client-sent `username` field is read only for pre-token clients and is removed in the next protocol major; new clients send it equal to the token handle. The teeth are on collision: a `name_verified` connection displaces a live unverified holder of the same name via the same `SessionTakenOver` path, so the real owner always wins the name.

Because of that displacement rule, a reconnect may never present a weaker identity than the one the session authenticated with — a downgraded re-auth gets the live session displaced as an impostor by its own next verified connection. The client therefore reuses its session token verbatim across reconnects (`resolveRelayIdentity` in `src/lib/relayIdentity.ts`, pure — the pinned identity lives with the connection in `platform/web.ts`), re-mints only on self-detected expiry or the relay's refusal, and never falls back to unsigned for an account session (a failed mint fails the attempt into the reconnect backoff; guests keep the availability-first unsigned fallback). The relay's side of the contract: a signed token that verifies but fails freshness is refused with an explicit `AuthResult` error containing "token expired" (`ResolvedIdentity::stale_token`) instead of being silently ignored — silent degradation to the legacy `username` field is reserved for tokens that never verified at all.

Hub guest tokens are signed like account tokens (`sub` prefixed `guest:`, `identity_token::GUEST_SUBJECT_PREFIX`), so `name_verified` alone does not mean "has an account". The lobby's `PlayerList` exposes `PlayerInfo.verified` — `name_verified` and a non-guest account subject (`ConnectedPlayer::verified`); the client does not currently render it. Because identity is resolved per `Authenticate`, the relay pushes a fresh `PlayerList` to every connected non-service session on session auth and disconnect (`broadcast_player_list`) — without it, roomless clients had no signal that presence or identity changed and rendered stale rosters indefinitely. A signed token may also carry a `qualification` claim (hub-assigned account role, e.g. `maintainer`, never minted for guests); the relay trusts it only from signed tokens and relays it as `PlayerInfo.qualification`, an opaque string the client maps to a badge and ignores when unknown. The same path carries an `avatar_url` claim (the account's avatar asset URL, minted from `accounts.avatar_asset_id` at token issue) into `PlayerInfo.avatar_url` for the lobby roster; unsigned tokens and guests never produce one, so an avatar in the lobby always means a verified account.

A session with no proof at all keeps the pre-identity behaviour — the old duplicate-username rejection and the stale/disconnected reclaim paths. With no JWKS url configured (the self-hosted case), signed tokens do not resolve; unsigned names and device proofs carry the whole feature.

## Observability

`/metrics` (Prometheus) on the health port (incl. `manabrew_relay_session_takeovers_total`); env-gated analytics JSONL + per-game zstd stream capture (`MANABREW_EVENTS_DIR`, `MANABREW_GAME_CAPTURE_DIR`).

## Cosmetics

`SetDeckSelection.avatar_url` and `Deck.playmat_url` carry the image URL the hub handed the uploader, and the relay passes them through untouched — it holds no bucket configuration, resolves nothing, and validates nothing. That is the same trust level the deck's card art already travels at: `Deck.cards[].uris` reaches `useScryfallStore` and renders unvalidated, so a cosmetic URL is not a new surface and a relay-side allowlist would only have covered half of one. Whether a URL is worth loading is the receiving client's call. `Deck.playmat_asset_id` rides along for the hub's foreign key and means nothing to the relay.

The inline `data:image/webp;base64,` encoding these fields used to carry is gone, not deprecated — the fields are URLs and nothing accepts a blob any more.
