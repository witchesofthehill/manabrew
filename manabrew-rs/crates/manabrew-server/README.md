# Forge Server

> **Parity is DEPRECATED and NOT FUNCTIONING.** Do not run `yarn parity`, the parity harness (`manabrew-rs/crates/parity`), the parity debugger, or `DeterministicController`. Do not limit or shape a change to keep parity behavior; ignore any instruction here that exists only to keep parity runs passing.

WebSocket-based game lobby server for Forge.

## Running with Docker

```bash
# From this directory (manabrew-rs/crates/manabrew-server/)

# Start the server
docker compose up -d

# View logs
docker compose logs -f

# Stop the server
docker compose down
```

The server listens on **ws://localhost:9443** by default.

## Configuration

All config is via environment variables. Edit `compose.yml` or pass overrides:

| Variable              | Default                | Description               |
| --------------------- | ---------------------- | ------------------------- |
| `FORGE_HOST`          | `0.0.0.0`              | Bind address              |
| `FORGE_PORT`          | `9443`                 | Listen port               |
| `FORGE_MAX_ROOMS`     | `100`                  | Max concurrent rooms      |
| `MANABREW_SERVER_KEY` | `forge`                | Server authentication key |
| `RUST_LOG`            | `manabrew_server=info` | Log level filter          |

The `manabrew` web bundle is configured at **build time** via `Dockerfile.web`
build args (the relay endpoint is baked in):

| Build arg                | Default   | Description                                                                                 |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------- |
| `VITE_RELAY_HOST`        | localhost | WebSocket relay host the browser connects to                                                |
| `VITE_RELAY_PORT`        | `9443`    | Relay port                                                                                  |
| `VITE_RELAY_PASSWORD`    | `forge`   | Relay authentication key                                                                    |
| `VITE_HOSTED_AI_ENABLED` | `false`   | Makes the hosted (server-side Java) engine **available** — shows the Settings engine toggle |

**Web "Play vs AI" does not depend on the node by default.** With
`VITE_HOSTED_AI_ENABLED` unset/false, 1v1-vs-AI runs the engine client-side
(WASM) — no `self-hosted-node` required, and the Settings engine toggle is
hidden. Building with `VITE_HOSTED_AI_ENABLED=true` (e.g. on staging) makes the
hosted engine **available**: a per-user **Settings → "Use hosted Java engine"**
toggle appears, and play stays client-side until a user opts in. Run the node too:

```bash
docker compose --profile hosted-ai up    # production: starts the self-hosted-node
```

The node hosts a `hosted` room, which is **not advertised** in the lobby's
human room list (hosted rooms are observer/AI-host rooms); the Play-vs-AI flow
still discovers it server-side. So the node can stay live without cluttering
the lobby.

**Known limitation:** some search prompts that ask for a card by subtype
(e.g. Flamekin Harbinger fetching an Elemental) don't render correctly in the
hosted-Java flow yet.

```bash
# Example: custom port and key
FORGE_PORT=8080 MANABREW_SERVER_KEY=mysecret docker compose up -d
```

## Building without Docker

```bash
cargo build --release -pmanabrew-server
FORGE_PORT=9443 ./target/releasemanabrew-server/
```

## Completed games and rematches

The relay advertises `game_rematch` in `AuthResult.features`. A host files `ReportGameOutcome` before `FinishGame { game_id }`; only a reported, non-crashed game-over outcome can finish. Limited sessions and their child matches retain their existing return workflow.

`RoomStatus::Finished` retains seats, selected decks, settings and the final per-seat replay for `RequestResync`. `RoomInfo.rematch` contains the completed game ID, a fixed list of human usernames with `Deciding`, `ChoosingDeck` or `Ready` intent, and a cancellation flag. It contains no deck contents. Each human sends `SetRematchIntent { game_id, intent }` independently. Changing a deck clears that player's consent. When every original human is connected and ready, every retained seat has a deck, and the engine host is connected, the relay starts one fresh game through the normal `GameStarted` path.

A departure cancels the agreement without removing the other seats. A surviving human can send `ReturnToLobby { game_id }` after cancellation to retain the remaining decks and settings while clearing readiness and retiring the old replay. Losing the engine host follows room ownership and reconnect grace, not host migration. `EndGame` remains the destructive abort path. Completion analytics are emitted once at `FinishGame`, not again when the room rematches, resets or is removed.
