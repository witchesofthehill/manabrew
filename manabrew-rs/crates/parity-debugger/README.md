# Forge Engine Debugger

Native `egui` debugger for Rust/Java parity inspection.

## Launch

From the repo root:

```bash
yarn parity:gui
```

That runs:

```bash
cargo run -pparity-debugger
```

## Common setup

- Card archive: `src-tauri/resources/cardset.rkyv`
- Java harness JAR: `forge-harness/target/forge-harness-jar-with-dependencies.jar`

If the Java harness is missing, build it with:

```bash
yarn build:harness
```

## What it does

- inspect card source, summary, and parsed AST
- run Rust traces
- run Java traces
- run side-by-side parity traces with live divergence inspection
- copy a matching `parity` CLI command for the current matchup

## Matchup flow

1. Open `Run config`
2. Pick a regression preset or set decks manually
3. Set seed / turns / game index
4. Choose `Rust`, `Java`, or `Side-by-side`
5. Run the trace

## Notes

- In side-by-side mode, the timeline is grouped by visible priority passes.
- The debugger stops on the first stable parity divergence and captures the rest of the failing turn for context.
