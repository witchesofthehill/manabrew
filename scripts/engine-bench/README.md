# Engine bench

Plays whole Forge games headlessly and records what each decision cost. Built to
answer #817, the four-seat Commander stall.

Two drivers, same game and same policy. `forge-wasm-game.mjs` runs the browser
engine on Node, `forge-jvm-game.py` runs the JVM harness. Having both is the
point: they differ in threading and in whether a profiler can name anything.

```sh
npm install --no-save @manabrew/forge-wasm@latest
node --trace-gc scripts/engine-bench/forge-wasm-game.mjs --seats 4 --out g4.jsonl > g4.log
python3 scripts/engine-bench/summarise.py 'g*.jsonl'
```

`--seats` 2 or 4, `--decks` a comma-separated list of `public/preset_decks`
basenames or deck files, `--out` the JSONL, `--timeout` seconds. By default the
human seat passes on every priority, so a reading is the AI's cost and not a
scripted line of play. `--policy greedy` plays a land a turn, casts what
auto-pay can cover and attacks with everything, which puts the human's
permanents on the board. `--engine <dir>` loads a checkout's
`packages/forge-wasm` (after `yarn build:forge-wasm`) instead of the npm
package. `--games N` plays N games in one engine and samples the host heap
between them. `--seed` pins the shuffle.

For the external controller path, build Manabrew WASM and run all Forge seats
through local Manabot instances:

```sh
yarn ensure:wasm
yarn bench:manabot --engine packages/forge-wasm --seed 7015 --out manabot-7015.json
```

This reports per-seat casts, land plays, abilities, passes, attackers, blocks,
mulligans, prompt/action counts, payment attempts/cancellations, optional choices,
card selections and target intent/ownership, plus the final outcome and
response-to-next-prompt latency.
Use `--decks`, `--timeout`, `--engine`, and `--wasm` to override its inputs.
Commander, Brawl, Oathbreaker, and 60-card constructed presets are supported;
all selected decks must share a format. Starting life follows the format and can
be overridden with `--starting-life`.
`--wasms` accepts one WASM directory per seat for direct policy A/B games.
`--forge-ai-seats 1,3` assigns those seats to Forge's internal AI, enabling a
direct Forge-versus-Manabot benchmark when the selected engine facade supports
mixed seats. Rotate the assignment between games to remove deck and seat bias.

```sh
yarn bench:manabot-pop --engine target/engines/prod --games 40 --out /tmp/pop-main
yarn bench:manabot-pop --engine target/engines/prod --wasms src/wasm,/tmp/wasm-main --games 24 --out /tmp/ab
yarn bench:manabot-pop --summarise /tmp/pop-main
```

`manabot-pop.mjs` plays that game `--games` times from `--seed-base`, `--jobs`
at a time, rotating side A through four seat pairs so every deck is played by
both sides. Without `--wasms` side B is Forge's AI; with two builds it is the
second one on the same seeds. The summary counts wins per side, deck and seat
with a sign test, play counts per seat-game, response latency and the bot's own
`decide`/`observe` time. A finished game is never replayed, so a stopped run
resumes. `--seats 2 --decks a,b` plays duels, side A alternating seats.
`manabot-game.mjs --trace chooseBlockers,chooseAttackers` writes each such
prompt with the seat's view and the decision as one JSON line on stderr; a
game the engine ends with an exception reports `outcome.reason` `engine_error`.

## A run, not a game

```sh
node scripts/engine-bench/stress.mjs --tag main --seats 2,4 --games 12
node scripts/engine-bench/stress.mjs --tag pr --engine packages/forge-wasm --seats 2,4 --games 12
python3 scripts/engine-bench/pool.py scripts/engine-bench/runs/pr \
  --baseline scripts/engine-bench/runs/main --fail-over 25
```

`stress.mjs` plays a matrix, a game per process, `--jobs` at a time (half the
cores by default). Decks rotate through a pool: the ten Commander presets, or
`--decks` as a list or a directory of deck files. `--per-engine N` plays N
games back to back in each process, which is what a tab does. `pool.py` reads
the run as one population: same-turn percentiles by seat count and prompt
type, game outcomes, human acts, loop flips, rss per game and GC pauses under
`--trace-gc`. With `--baseline` every cell is a ratio and `--fail-over` turns
it into an exit code. `--json` keeps a run's table for a later baseline.

Two hundred decisions per cell is where the p90 stops moving between runs.
Twelve 4-seat games is about two thousand `chooseAction` decisions.

## A/B

```sh
node scripts/engine-bench/fetch-engine.mjs --into target/engines/prod
node scripts/engine-bench/stress.mjs --tag ab --engines prod=target/engines/prod,pr=packages/forge-wasm \
  --seats 2,4 --games 30 --jobs 3
python3 scripts/engine-bench/pool.py --ab scripts/engine-bench/runs/ab --fail-over 20
```

`fetch-engine.mjs` assembles an engine directory from a deployed site: the
launcher and wasm players are running, under this checkout's facade. No Web
Image toolchain and no npm release needed to bench prod or staging
(`--from https://staging.manabrew.app`).

`--engines` plays the one plan under every arm, same seeds and decks, arms
interleaved in the queue so machine load lands on both. The first arm is the
control. `pool.py --ab` gives each cell the ratio of p50 and p90, a 95%
bootstrap interval and the share of resamples in which the arm is slower.

The bootstrap resamples games, not decisions. A game's decisions rise and fall
with its board, so an A/A test over decisions reported a 25% difference that
was not there; over games the same run reads 0.7-1.2. That is also why the
interval narrows with games rather than decisions: eight per arm is a smoke
test, thirty is where a 20% change separates from noise. `--fail-over` fails
only when the whole p50 interval sits above the threshold.

Read the same-turn half. The cross-turn half contains whole opponent turns.
`docs/agents/LATENCY_ANALYSIS.md` has the rest of the traps.

## What it is for

The browser tests measure the client. This measures the engine: same Forge, same
worker, no render loop in front of it. A four-seat Commander game takes about
two minutes and reproduces the production stall signature.

Run it under `--trace-gc` and `summarise.py` sums the collector's pauses, which
is what tells a GC pause from a slow AI search. The engine's Java heap is the
host's, because the Web Image build targets WasmGC and declares no linear
memory, so there is no engine-side heap cap to raise.

## The JVM driver

```sh
node scripts/harness.mjs build
python3 scripts/engine-bench/forge-jvm-game.py --seats 4 --out g4.jsonl --jfr g4.jfr
```

Wasm frames in a released build carry no names, so a profile there stops at
`wasm-function[51278]`. The JVM gives Java stacks for the same AI on the same
board, which is how #817 was found.

A seed replays the same game on both runtimes when the human seat answers the
same way: `--policy greedy` here mirrors the wasm driver's, and the seat names
match. So a stall seen in a `stress.mjs` run can be replayed on the JVM by seed
with `--sysprop forge.synchronous=true --jfr`, and the fix measured on the
identical game (same decision count, same turn count) rather than on a
population. That is how the alternative-cost and `canGainKeyword` reorders in
witchesofthehill/forge#13 were found and checked.

Do not A/B whole games. They diverge run to run even at a fixed seed, so game
length swamps the change under test. Compare profiles, or pool decisions across
several games and read the percentiles.
