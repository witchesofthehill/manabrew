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
basenames, `--out` the JSONL, `--timeout` seconds. The human seat passes on every
priority, so a reading is the AI's cost and not a scripted line of play.

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

## A/B on the wasm engine

Building the wasm engine locally takes about 100 seconds, not the hour the
module size suggests:

```sh
export WEBIMAGE_GRAALVM_HOME=~/.local/graalvm/graalvm-25.3.4.1-dev+0.1/Contents/Home
./scripts/build-forge-wasm.sh
cp public/forge/forgeharness.js{,.wasm} node_modules/@manabrew/forge-wasm/
node scripts/engine-bench/forge-wasm-game.mjs --seats 4 --out arm.jsonl
```

Dropping the two build outputs straight into the installed package is what makes
an A/B cheap: the JS wrapper, the worker and the card data stay fixed, and only
the engine module changes. Keep a copy of each arm's pair of files and swap them
between runs.

The build also leaves a `forgeharness.js.wat` next to them, about 750MB, which
is the only way to put names on a wasm profile. It only matches the `.wasm` from
the same build.

Two limits. `forge-wasm-game.mjs` has no seed option, so the arms cannot replay
the same game the way the JVM pairs can, and wasm has no system properties, so
the AI's deadline cannot be pinned there either. Pool several games per arm and
bin by turn, and treat the result as indicative rather than controlled.

## The JVM driver

```sh
node scripts/harness.mjs build
python3 scripts/engine-bench/forge-jvm-game.py --seats 4 --out g4.jsonl --jfr g4.jfr
```

Wasm frames in a released build carry no names, so a profile there stops at
`wasm-function[51278]`. The JVM gives Java stacks for the same AI on the same
board, which is how #817 was found.

Do not A/B whole games. They diverge run to run even at a fixed seed, so game
length swamps the change under test. Compare profiles, or pool decisions across
several games and read the percentiles.
