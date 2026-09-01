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

## Counting instead of timing

`--counters` records what the engine did for each decision rather than only how
long it took: static-ability passes, calls to `getValidCards`, cards examined by
them, `Card.isValid` and `CardProperty.cardHasProperty` entries, and how many
times an AI seat took priority. A count is deterministic where a duration is
not, so it survives the divergence that makes whole-game A/B useless.

It needs the engine counters, which live on the fork's `khaliostr/decision-counters`
branch and are not in a release build. Check that branch out in `forge/`, rebuild,
and pass the flag:

```sh
git -C forge fetch origin khaliostr/decision-counters && git -C forge checkout khaliostr/decision-counters
node scripts/harness.mjs build
python3 scripts/engine-bench/forge-jvm-game.py --seats 4 --counters --out c4.jsonl
python3 scripts/engine-bench/counters.py --type chooseAction 'c4*.jsonl'
python3 scripts/engine-bench/property-chain.py 'c4*.jsonl'
```

`counters.py` bins by battlefield size rather than by turn, and reports per AI
priority as well as per decision. Both matter. A decision here is the gap
between two prompts to the human seat, and at four seats that gap holds three
AI seats taking priority where two seats holds one, so per-decision counts are
not comparable across seat counts. It also reports the share of each decision
spent inside `isValid` and `cardHasProperty`, measured with nanoTime and
corrected for what nanoTime itself costs, which is a number the profile does
not give you.

`property-chain.py` joins the property histogram to `CardProperty`'s if/else
chain and says how many string comparisons the engine walked to answer them.

Everything is behind `-Dforge.engineCounters=true`, a static final read at class
init, so it folds away when it is off. An earlier round of this used atomics and
two `nanoTime` calls on every `checkStaticAbilities` and had to be reverted
(forge `9d14d1511bf`).
