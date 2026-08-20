# self-hosted-node

Headless room host. Connects to a relay, opens one or more lobby rooms, and
runs the games for everyone who joins — with the `forge` backend it spawns one
Forge JVM per concurrent game. Setup, Docker usage, and the full environment
variable reference live in the
[self-hosting docs](https://docs.manabrew.app/self-hosting/).

## Signals

| Signal               | Behavior                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SIGTERM` / `SIGINT` | Immediate shutdown: every room closes (relay sockets get a proper WebSocket close), games in progress end.                                                                                |
| `SIGUSR1`            | Drain: stop starting new games, close each room once it has no game running, exit `0` when the last room closes. Games in progress run to completion. Use it to retire or replace a node. |

The `--shutdown-on-stale` flag (or `SELF_HOSTED_NODE_SHUTDOWN_ON_STALE`) is the
automated variant: the node polls the version manifest and, when a newer
release is published, exits once idle so a pull-on-restart supervisor respawns
it updated.
