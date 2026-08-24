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
it spent between receiving the response and producing that message. Before that
change the split had to be inferred, and the scripts here still do so for older
captures.

`engineMs` alone does not leave the hop. It is sampled when the engine's message
is picked up, and the node then serialises the state, fingerprints it, compares
it against the last one and diffs it, all of which grows with the board. That is
what `emitMs` covers. The hop is

```
(response -> next board)  -  engineMs  -  emitMs
```

An envelope carrying `engineMs` but no `emitMs` predates that split, so its
node-side work is only partly accounted for.

## Six traps

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

**5. Most captures are patches, not states.** State patches became the default
on 2026-08-20 (`feat(node): stop relay writes from blocking the room loop, send
patched state and move to graalVM`). A reader that pairs a response only with
`"kind":"state"` therefore measures the wait for the next _full_ state, which by
08-21 is a rare resync rather than the engine's answer. On three days after the
rollout that reader kept 110 games out of 449 and reported a network floor of
220ms against a true 109ms. Every optimisation deploy so far landed inside that
window, which is why none of them appeared to move anything. Read `stateDelta`
too, and rebuild the board from the patches. `scripts/latency/state_delta.py`
does this.

**6. The node's reply is often the next question, not a board.** Trap 1 handles a
prompt to a _different_ seat. It does nothing about the node asking the _same_
player several questions back to back and sending a board only at the end. A
reader that waits for the board holds the decision open across every think in
between and charges all of it to the node. One capture recorded a 152-second
decision this way; the node had in fact replied in 212ms, and the rest was a
player thinking through three more prompts.

Close a decision at the node's **first** reply to that seat, state or prompt,
whichever comes first. The body of the distribution barely moves, which is why
this hides: on that game p50 and p90 were identical either way while the maximum
went from 152,156ms to 577ms. It is purely a tail artifact, so it corrupts
exactly the figures anyone investigating a stall will reach for.

## Controlling for the network

The hop to the engine host is a property of the game, not of the decision:
which host, how far, how loaded. Without `engineMs` and `emitMs`, the usable
control is each game's own floor.

Within one game the fastest decisions are the ones where the engine had least to
do, so that game's 5th percentile stands in for its hop. Excess over that floor
is engine work.

**The floor is not the hop, and the gap is large.** It is the hop plus whatever
the engine costs on its cheapest decision, and that is not small. In the first
game to carry both `engineMs` and `emitMs`, the measured hop was 47ms (p10 44,
p90 51) where that same game's floor was 108ms. Engine time came out at 80ms
against the 19ms the floor method infers, so the floor understated the engine by
about 4x and credited the difference to the network.

Treat every floor-derived figure as a lower bound on engine cost, and prefer the
measured split wherever the envelopes carry it. This rests on one game so far
and wants confirming at volume. The earlier agreement between the 107ms median
floor and the 112ms loopback wire floor should be re-examined at the same time,
since both may share the bias.

The floor is at least flat across board sizes, 104ms in the smallest games
against 123ms in the largest, so the board-size effect is not a network
artifact.

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

Both take a glob and stream the captures in parallel, shelling out to `zstd`.
A game with no patches in it is read with a regex, because state lines are most
of the bytes and only their timestamp and seat matter. A game with patches is
parsed and its board rebuilt through `state_delta.py`, which is slower and
unavoidable.

```
python3 scripts/latency/decision_latency.py 'captures/*/*.zst'
python3 scripts/latency/board_size_and_floor.py 'captures/*/*.zst'
```

`decision_latency.py` reports node time by deploy period, by prompt type, by
kind of play, and by turn, plus player think time. Edit `ERAS` to the dates you
care about; they are merge dates from `git log`, not verified deploy times, so
treat boundaries as approximate.

`board_size_and_floor.py` reports the per-game floor, whether the floor varies
with game size, and node time by board size and by play type both raw and
node-side. It prints the measured hop above the floor whenever the captures
carry `engineMs` and `emitMs`, so the two can be compared directly.

`state_delta.py` is the patch decoder, a port of
`manabrew-relay-protocol/src/state_delta.rs`. Keep the two in step.

Roughly four minutes for 7,600 games on eight cores. Watch for one pathological
game stalling a run: both scripts print progress per capture so a stall is
visible, which it was not in the first attempt.

## What the 40-day run found

Kept here so the next person has a baseline to compare against. Full output and
the published write-up live outside the repo.

These came from a run that predates trap 5, so they describe the fleet up to
2026-08-20 and say nothing reliable about anything after it. The re-run below
supersedes them where the two disagree.

- A normal decision costs the engine about 37ms. The ~180ms median is roughly
  107ms hop, 37ms engine, and scatter. **Both halves are now suspect**: see
  "Controlling for the network".
- Board size multiplies engine work about 26x between the smallest and largest
  boards. Ten-second waits go from 0.15% to 5.24% of decisions.
- Activating an ability costs about 15x a priority pass **at the same board
  size**, so it is slow in itself rather than by association with big boards.
  Together the two reach one activation in six waiting over ten seconds.
- `undoMana` has a bad tail even on small boards, which points at the undo path
  rather than at scale.

## What the patch-aware re-run found

Same 40 days, cut at the deploys rather than pooled, reading patches. Node-side
p50 for a priority pass, by board size, before `#691` against after `#738`:

| Board   | to 08-18 | from 08-22 |
| ------- | -------- | ---------- |
| <40     | 38ms     | 20ms       |
| 40-79   | 70ms     | 42ms       |
| 80-119  | 129ms    | 80ms       |
| 120-159 | 209ms    | 119ms      |
| 160-219 | 341ms    | 173ms      |

- The deploys took out roughly **half the engine time at every board size**.
- They did **not** flatten the curve. Smallest to largest is 9.0x before and
  8.7x after. Growth is near-linear in board size, so the wins were to the
  constant factor.
- Activating an ability is now the dominant player-visible cost and it is mostly
  **not** a board-size effect: 385ms against 20ms for a pass on the same <40
  board, and it grows sub-linearly from there. Treat it as a fixed cost.
- The window between correct heap sizing (`#730`) and the AiCache fix (`#738`)
  is the worst in the whole 40 days, which is consistent with a correctly sized
  heap still being filled by the leak.
- Counts thin out fast after 08-20: 4,471 games before, 222 in the last era.
  Cells above 220 cards run to tens of decisions and should not be quoted.
