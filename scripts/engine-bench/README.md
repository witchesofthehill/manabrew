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

## HotSpot does not compile the hot method

`CardProperty.cardHasProperty` is 14,112 bytes of bytecode. HotSpot refuses to
compile a method over 8000 (`DontCompileHugeMethods`, `HugeMethodLimit`), so on
a stock JVM it runs **interpreted for the whole game**: three to eight times its
compiled per-call cost, 10-28% of a four-seat game, and the top self frame in
any profile taken here.

Nothing we ship is HotSpot. The desktop engine is a GraalVM native image built
by `forge-harness/build-native.sh`, the browser one is Web Image, and both
compile every reachable method ahead of time. So this is a property of the
measuring rig, not of the product, and a profile taken with the limit in place
ranks the engine wrongly: with the method compiled, `cardHasProperty` leaves the
top of the profile entirely and `FCollection` allocation and the static-ability
rebuild take its place.

`forge-jvm-game.py` therefore passes `-XX:-DontCompileHugeMethods` by default.
`--no-compile-huge` puts the limit back, which is only worth doing to reproduce
an old measurement. Any JVM profile of this engine taken before 2026-09-01 was
taken with the limit on.

## The JVM driver

```sh
node scripts/harness.mjs build
python3 scripts/engine-bench/forge-jvm-game.py --seats 4 --out g4.jsonl --jfr g4.jfr
```

Wasm frames in a released build carry no names, so a profile there stops at
`wasm-function[51278]`. The JVM gives Java stacks for the same AI on the same
board, which is how #817 was found.

`jfr-top.py` ranks the frames in a recording by self and inclusive samples, and
splits the samples by thread so the AI's search can be told from the rules
engine.

```sh
python3 scripts/engine-bench/jfr-top.py g4.jfr
python3 scripts/engine-bench/jfr-top.py g4.jfr --thread 'Game AI Eval'
```

Do not A/B whole games without pinning the AI's deadline first. See below.

## The AI spends whatever you save

`AiController.chooseSpellAbilityToPlayFromList` bounds its own evaluation
against a wall clock, both with a timed `future.get` and with a cooperative
deadline checked between candidate abilities. Both read `game.getAITimeout()`,
five seconds by default.

So the AI does not do a fixed amount of work per decision. It does as much as
fits in the budget. Make the engine faster and it evaluates more candidates in
the same five seconds: it plays differently, the game diverges, and the wall
clock barely moves. An engine change can remove half the work and look like it
did nothing.

`--ai-timeout 600` pins the deadline high enough that it never binds, so both
arms evaluate everything and play the same game. Use it for any engine A/B.
Without it, a fixed seed is not a control: seeds that replayed identically with
the deadline pinned diverged 854 decisions against 783 without it.

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
