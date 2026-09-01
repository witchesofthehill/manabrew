# Engine bench

Plays whole Forge games headlessly and records what each decision cost. Built to
answer #817, the four-seat Commander stall.

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
