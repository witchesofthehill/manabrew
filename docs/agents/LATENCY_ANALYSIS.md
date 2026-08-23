# Measuring hosted latency

How to answer "is the game slow, and where does the time go" from production
data, and the traps that make it easy to answer wrongly.

Read `docs/agents/RELAY.md` for the capture format and
`docs/agents/SELF_HOSTED_NODE.md` for what the engine host does.

## Where the data is

The relay writes one zstd-compressed JSONL file per game to
`MANABREW_GAME_CAPTURE_DIR` (`ops/observability/data/captures/<date>/<game-id>.jsonl.zst`
in the production compose file). Line one is the `game_started` event; every
line after it is `{ts, from, envelope}`, where `envelope` is a `StateEnvelope`.

Retention is `MANABREW_GAME_CAPTURE_MAX_GB`, currently 20.

Pull a slice to work on locally:

```
rsync -az -r root@<relay>:/opt/manabrew/ops/observability/data/captures/2026-08-21 ./captures/
```

## What a timestamp means

**Every `ts` is the relay's.** Not the client's, not the engine host's. For one
seat's decision:

```
prompt   -> response      the player deciding, plus their own round trip
response -> next board    the engine host working, plus the hop to it
```

Since `feat(node): report engine time and client round trip`, the second gap
comes apart: envelopes from the engine host carry `engineMs`, the milliseconds
it spent between receiving the response and sending that envelope. Subtracting
it leaves the hop. Before that change the split had to be inferred, and the
scripts here still do so for older captures.

## Four traps

Each of these was hit while producing the 40-day analysis, and each moved the
headline numbers by more than any real code change did.

**1. Another player thinking is not engine time.** Pairing a response with the
next board for that seat looks right and is not. When the engine asks a
_different_ player something in between, that player's thinking sits inside the
gap. Those decisions were 9% of the sample and carried almost the entire
extreme tail: p99 of 43 seconds against 7.8 for the rest. Drop any decision
with an intervening prompt to another seat.

**2. Load tests and non-Forge games are in the same directory.** Filter games
whose `game_started` players include a `loadtest`/`probe` account, and games
whose `engine` is not `Forge`. The second matters more than it sounds: the Rust
engine measured against a game it played itself is not a measurement.

**3. Turn number is not board size.** A long game and a big game are different
things, and using turns as a proxy produces the conclusion that board size does
not matter. It does, enormously. Count visible card objects in the seat's view
instead; `"summoningSick"` occurs once per card and is cheap to count without
parsing the state.

**4. Percentiles hide concentration.** Only about 1.2% of decisions happen on a
board of 120 cards or more, so they barely move a global percentile. They are
not spread evenly: they cluster in a few long multiplayer games, and inside one
of those every decision is slow. A global p50 describes a game nobody is
complaining about. Always bucket by board size before concluding anything.

## Controlling for the network

The hop to the engine host is a property of the game, not of the decision:
which host, how far, how loaded. Without `engineMs`, the usable control is each
game's own floor.

Within one game the fastest decisions are the ones where the engine had almost
nothing to do, so that game's 5th percentile approximates its hop. Excess over
that floor is engine work. It is deliberately conservative: a game that is
uniformly slow folds its slowness into its own floor, so engine cost comes out
understated rather than overstated.

Two independent checks that this works. The median floor across ~5,000 games is
107ms, within 5ms of the 112ms wire floor measured on the loopback rig by a
different method. And the floor is flat across board sizes, 104ms in the
smallest games against 123ms in the largest, so the board-size effect is not a
network artifact.

## The client's own leg

Not visible in captures. The relay never sees the client's clock, and every
prompt a player answers contains their thinking.

Do not use dice-roll acknowledgements as a proxy. That prompt is display-only
and the client waits for its animation before acknowledging, so the number
measures animation plus network. An earlier version of the 40-day analysis did
exactly this and the figures had to be withdrawn.

Use `manabrew_relay_client_rtt_ms` instead. The relay's websocket heartbeat
carries its send time and RFC 6455 requires the peer to echo a ping's payload,
so it is a true round trip measured on one clock.

## The scripts

Both take a glob and stream the captures in parallel. They shell out to `zstd`
and read state envelopes with a regex rather than a JSON parse, because state
lines are most of the bytes and only their timestamp and seat matter.

```
python3 scripts/latency/decision_latency.py 'captures/*/*.zst'
python3 scripts/latency/board_size_and_floor.py 'captures/*/*.zst'
```

`decision_latency.py` reports node time by deploy period, by prompt type, by
kind of play, and by turn, plus player think time. Edit `ERAS` to the dates you
care about; they are merge dates from `git log`, not verified deploy times, so
treat boundaries as approximate.

`board_size_and_floor.py` reports the per-game floor, whether the floor varies
with game size, and node time by board size and by play type both raw and as
excess over each game's floor.

Roughly four minutes for 7,600 games on eight cores. Watch for one pathological
game stalling a run: both scripts print progress per capture so a stall is
visible, which it was not in the first attempt.

## What the 40-day run found

Kept here so the next person has a baseline to compare against. Full output and
the published write-up live outside the repo.

- A normal decision costs the engine about 37ms. The ~180ms median is roughly
  107ms hop, 37ms engine, and scatter.
- Board size multiplies engine work about 26x between the smallest and largest
  boards. Ten-second waits go from 0.15% to 5.24% of decisions.
- Activating an ability costs about 15x a priority pass **at the same board
  size**, so it is slow in itself rather than by association with big boards.
  Together the two reach one activation in six waiting over ten seconds.
- `undoMana` has a bad tail even on small boards, which points at the undo path
  rather than at scale.
