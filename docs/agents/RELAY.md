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

When a token resolves, the relay adopts the name it carries (`AccessClaims.handle`) as the session's display username, ignoring the client-sent `username` — a signed-in account plays under its Hub handle, a guest under a Hub-vouched guest-token name (`/api/auth/guest-token`, refused when the base name is a claimed handle). Verification is advisory, not required: a connection with no resolving token is admitted under its client-sent name, so the Hub is never a hard dependency for connecting, and the claimed-name check runs client-side at name-selection time. The teeth are on collision: each session records whether its name was token-verified (`name_verified`), and a token-verified connection displaces a live unverified holder of the same name via the same `SessionTakenOver` path.

Everything else keeps the pre-identity behaviour — no proof and no stored identity means the old duplicate-username rejection and the stale/disconnected reclaim paths — so bots, hosted nodes, and older clients are unaffected. With no JWKS url configured (the self-hosted case), token proofs simply do not resolve and device proofs carry the whole feature.

## Observability

`/metrics` (Prometheus) on the health port (incl. `manabrew_relay_session_takeovers_total`); env-gated analytics JSONL + per-game zstd stream capture (`MANABREW_EVENTS_DIR`, `MANABREW_GAME_CAPTURE_DIR`).
