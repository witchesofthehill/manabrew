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

| Variable                     | Default                              | Description                                                                               |
| ---------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `MANABREW_SERVER_HOST`       | current browser host                 | WebSocket server host used by browser clients; may also be a full `ws://` or `wss://` URL |
| `MANABREW_SERVER_PORT`       | `9443`                               | WebSocket server port used by browser clients                                             |
| `MANABREW_SERVER_USERNAME`   | generated per browser session        | Optional username default                                                                 |
| `MANABREW_SERVER_PASSWORD`   | `FORGE_SERVER_KEY` / `forge`         | Server authentication key used by hosted AI play                                          |
| `MANABREW_HOSTED_AI_ENABLED` | `true` in compose, `false` otherwise | Enables web Play vs AI to route through a self-hosted-node room                           |

When hosted AI is enabled, run at least one `self-hosted-node` connected to the
same server and advertising a hosted room for the format the browser will play.

```bash
# Example: custom port and key
FORGE_PORT=8080 FORGE_SERVER_KEY=mysecret docker compose up -d
```

## Building without Docker

```bash
cargo build --release -p forge-server
FORGE_PORT=9443 ./target/release/forge-server
```
