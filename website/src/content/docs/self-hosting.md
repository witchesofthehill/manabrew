---
title: Self-hosting a Java room
description: Run your own headless game room backed by the Java Forge engine, via Docker Compose or from source.
---

A **self-hosted node** is a headless room host. It connects to a relay server,
opens a lobby room, and runs the games for everyone who joins — players only
need the web or desktop client. With the `java-forge` backend the node spawns
one Java Forge process per game, so games are played on the original Forge
rules engine rather than the Rust port.

Both options below start from a full checkout:

```bash
git clone --recurse-submodules https://github.com/witchesofthehill/manabrew.git
cd manabrew
```

The node authenticates to the relay with the relay's server key. Set it via
`SELF_HOSTED_NODE_SERVER_KEY` — never commit it anywhere.

## Option 1: Docker Compose

The image bundles everything: the node binary, the Java Forge harness, and a
JRE. Create a `compose.yml`:

```yaml
services:
  self-hosted-node:
    build:
      context: .
      dockerfile: forge-engine/crates/self-hosted-node/Dockerfile
    environment:
      SELF_HOSTED_NODE_RELAY_URL: "wss://relay.manabrew.app"
      SELF_HOSTED_NODE_SERVER_KEY: "${SELF_HOSTED_NODE_SERVER_KEY:?required}"
      SELF_HOSTED_NODE_ROOM_NAME: "my-room"
      RUST_LOG: "self_hosted_node=info"
    restart: unless-stopped
```

The image defaults to the Java backend, so no extra configuration is needed:

```bash
SELF_HOSTED_NODE_SERVER_KEY=… docker compose up --build
```

## Option 2: From source

You need a Rust toolchain, a JDK (17+), and Maven.

Build the Java Forge harness jar and the cardset archive once:

```bash
mvn -pl forge-harness -am package -DskipTests
cargo run --release -p forge-cardset-archive --features build --bin build-cardset-archive
```

Then run the node:

```bash
SELF_HOSTED_NODE_ROOM_NAME=my-room \
SELF_HOSTED_NODE_SERVER_KEY=<your-server-key> \
SELF_HOSTED_NODE_ENGINE_BACKEND=java-forge \
SELF_HOSTED_NODE_RELAY_URL=wss://relay.manabrew.app \
JAVA_HOME="$(/usr/libexec/java_home)" \
cargo run --release -p self-hosted-node --features java-forge
```

`$(/usr/libexec/java_home)` resolves the JDK path on macOS; on Linux point
`JAVA_HOME` at your JDK installation (for example
`/usr/lib/jvm/temurin-21-jdk`).

## Configuration

All settings are environment variables:

| Variable                          | Default               | Purpose                                              |
| --------------------------------- | --------------------- | ---------------------------------------------------- |
| `SELF_HOSTED_NODE_RELAY_URL`      | `ws://127.0.0.1:9443` | Relay server to connect to                           |
| `SELF_HOSTED_NODE_SERVER_KEY`     | —                     | Relay server key (must match the relay's)            |
| `SELF_HOSTED_NODE_ROOM_NAME`      | `Self-Hosted Node`    | Lobby name shown to players                          |
| `SELF_HOSTED_NODE_ROOM_PASSWORD`  | none                  | Require a password to join                           |
| `SELF_HOSTED_NODE_FORMAT`         | `any`                 | Game format (e.g. `commander`)                       |
| `SELF_HOSTED_NODE_MAX_PLAYERS`    | `4`                   | Seats in the room                                    |
| `SELF_HOSTED_NODE_MAX_GAMES`      | `1`                   | Concurrent games the node will run                   |
| `SELF_HOSTED_NODE_ENGINE_BACKEND` | `rust`                | `java-forge` for the Java engine (`java` also works) |
| `SELF_HOSTED_NODE_BOT_ENABLED`    | `false`               | Seat an AI bot in the room                           |
| `SELF_HOSTED_NODE_AUTO_START`     | `false`               | Start as soon as the room fills                      |

## Hosting your own relay

You don't have to use the public relay — the relay server (`forge-server`) is
part of the repo and self-hostable too. It handles lobbies, matchmaking, and
message relay between players; it never runs games itself.

```bash
FORGE_SERVER_KEY=<pick-a-key> cargo run --release -p forge-server
```

It listens for WebSocket connections on port `9443` (override with
`FORGE_PORT`) and serves a health endpoint on `9444`. Point your node and your
clients at it with `ws://your-host:9443` — or put it behind a TLS-terminating
proxy and use `wss://`. The key you pick is the same one your nodes pass as
`SELF_HOSTED_NODE_SERVER_KEY`.

A Dockerfile is available at `forge-engine/crates/forge-server/Dockerfile`, and
`compose.production.yml` in the repo root shows a complete relay + node
deployment behind Caddy.

## Hosting the web client

The browser client is a static site (`yarn build:web` → `dist/`), but it is not
"just static files": the game worker uses `SharedArrayBuffer`, which requires
cross-origin isolation. Whatever serves it — and every proxy in front — must
deliver these headers on the HTML, worker JS, and WASM responses:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

If a proxy strips them, the page loads but games won't start. Verify in
DevTools: `window.crossOriginIsolated` must be `true`. Also note the web client
is not offline-capable — card images come from Scryfall at runtime.
`ops/Caddyfile` in the repo is a working reference configuration.
