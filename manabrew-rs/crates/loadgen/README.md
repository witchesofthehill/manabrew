# loadgen

Drives real games against a relay so whatever is hosting them can be measured
under load. Every client speaks the production protocol and answers its prompts
with `manabot`'s `SimpleAi`, so the host cannot tell it from a player.

```sh
cargo build --release -p loadgen
HOSTS=<node-id-prefix> PER_HOST=4 DURATION_S=480 FORMAT=Modern \
  ./target/release/loadgen
```

## Two modes

**The hosted fleet**, by default: claim empty hosted rooms, ask each node for an
AI opponent with `spawnBot`, start the game, play.

**A named room**, with `ROOM`: join rooms whose id or name contains one of the
given substrings, take a free seat, and wait for whoever controls the room to
start. Nothing is spawned and nothing is started, so the host can be anything
that speaks the protocol, including a browser hosting a table on Forge wasm or
on the Rust engine. That host is otherwise unmeasurable from outside.

```sh
ROOM="my table" START_WAIT_S=600 DURATION_S=900 FORMAT=Modern \
  ./target/release/loadgen
```

Start the client only once the browser has created the table: rooms are picked
from a single `ListRooms` at startup.

## What it measures

Per prompt, the time between sending a response and receiving the next prompt
for that seat. That is what a player waits, so it contains the AI opponent's
whole turn and two network crossings as well as engine time. It is not a
measure of engine latency on its own.

Where the host stamps `engineMs` on the prompt, that is recorded too and
reported as `eng_p50`. The self-hosted node stamps it; the browser workers do
not.

The summary prints per-client and pooled p50/p90/p99, the join-to-`GameStarted`
time, bytes received, and how many frames arrived as `stateDelta` rather than
full states.

## Environment

| Variable         | Default                         | Meaning                                                       |
| ---------------- | ------------------------------- | ------------------------------------------------------------- |
| `RELAY`          | `wss://relay.manabrew.app`      | Relay to dial                                                 |
| `RELAY_PASSWORD` | the public official-relay token | Shared access token                                           |
| `ROOM`           | unset                           | Comma-separated substrings matched against room id and name   |
| `HOSTS`          | every host                      | Comma-separated substrings matched against `RoomInfo.host`    |
| `PER_HOST`       | `4`                             | Rooms to claim per node                                       |
| `DURATION_S`     | `300`                           | Total run length                                              |
| `START_WAIT_S`   | `120`                           | How long to wait for the game to start                        |
| `GAME_S`         | unset                           | Concede after this many seconds, so `LOOP` cycles games       |
| `LOOP`           | unset                           | Start a fresh game whenever one ends                          |
| `STAGGER_MS`     | `500`                           | Delay between client starts                                   |
| `FORMAT`         | `Any`                           | Game format; the relay rejects `Any` with `format_not_chosen` |
| `DECK`           | Red Deck Wins preset            | Preset deck json to play                                      |
| `CLIENT_VERSION` | `3.17.3`                        | Reported app version                                          |
| `AS_BOT`         | on                              | Join as a bot seat; `0` joins as a human                      |
| `PREFIX`         | `loadtest`                      | Username prefix                                               |
| `RAW`            | unset                           | Append `user,seq,turnaround_ms,engine_ms` per prompt          |
| `VERBOSE`        | unset                           | Print every server message                                    |

`HOSTS` and `PER_HOST` apply to the default mode only; `ROOM` replaces them.

## Things worth knowing

`RoomInfo.host` is `self-hosted-node-<uuid>-<room index>`, so `HOSTS` matches a
substring and per-node counting strips the trailing index.

`StartGame` is sent only when the relay would accept it from this seat: the
first non-bot player in the room, or the first player if every seat is a bot.
A guest that sent it anyway would collect a `NotHost` error per room.

Report `CLIENT_VERSION` at or above `MIN_STATE_PATCH_VERSION` (3.17.0) or the
relay downgrades that seat to full states and the byte counts stop reflecting
what a current client receives.

Running this against production writes real rows to relay analytics. Bot seats
stay out of distinct-player counts, but the games themselves are recorded.
