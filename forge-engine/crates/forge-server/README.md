# Forge Server

WebSocket-based game lobby server for Forge.

## Running with Docker

```bash
# From this directory (forge-engine/crates/forge-server/)

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

| Variable           | Default             | Description               |
| ------------------ | ------------------- | ------------------------- |
| `FORGE_HOST`       | `0.0.0.0`           | Bind address              |
| `FORGE_PORT`       | `9443`              | Listen port               |
| `FORGE_MAX_ROOMS`  | `100`               | Max concurrent rooms      |
| `FORGE_SERVER_KEY` | `forge`             | Server authentication key |
| `RUST_LOG`         | `forge_server=info` | Log level filter          |

The `manabrew` web container also writes `/manabrew-config.js` at container
startup so the static browser bundle can be configured without rebuilding the
image:

| Variable                     | Default                       | Description                                                                               |
| ---------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| `MANABREW_SERVER_HOST`       | current browser host          | WebSocket server host used by browser clients; may also be a full `ws://` or `wss://` URL |
| `MANABREW_SERVER_PORT`       | `9443`                        | WebSocket server port used by browser clients                                             |
| `MANABREW_SERVER_USERNAME`   | generated per browser session | Optional username default                                                                 |
| `MANABREW_SERVER_PASSWORD`   | `FORGE_SERVER_KEY` / `forge`  | Server authentication key used by hosted AI play                                          |
| `MANABREW_HOSTED_AI_ENABLED` | `false`                       | Routes web Play vs AI through a self-hosted-node room instead of the client engine        |

**Web "Play vs AI" does not depend on the node by default.** With
`MANABREW_HOSTED_AI_ENABLED` unset/false, 1v1-vs-AI runs the engine
client-side (WASM) — no `self-hosted-node` required. Opt in by setting
`MANABREW_HOSTED_AI_ENABLED=true` and running the node:

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
FORGE_PORT=8080 FORGE_SERVER_KEY=mysecret docker compose up -d
```

## Building without Docker

```bash
cargo build --release -p forge-server
FORGE_PORT=9443 ./target/release/forge-server
```
