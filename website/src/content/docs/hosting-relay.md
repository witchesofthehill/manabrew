---
title: Hosting your own relay
description: Run the ManaBrew relay server (forge-server) that handles lobbies, matchmaking, and message relay between players.
---

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
