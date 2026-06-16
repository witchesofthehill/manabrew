# Parity Testing Guide

How to run parity tests comparing the Rust engine against the Java Forge
reference implementation.

## Prerequisites

1. **Java 18** (Zulu recommended):

   ```bash
   export JAVA_HOME=/Library/Java/JavaVirtualMachines/zulu-18.jdk/Contents/Home
   ```

## How to run a parity test

### 1. Use an existing regression entry when possible

Regression entries live in `manabrew-rs/crates/parity/regression.json`.
If the matchup is already listed there, run it by name:

```bash
yarn parity trigger_parity
```

Extra flags are appended after the test name:

```bash
yarn parity trigger_parity --investigate --verbose=7
```

### 2. Import the deck you intend to test

Create a file `my_deck.json` inside the `parity_decks/` root directory of the project.
Look at existing decks in that folder for reference on the expected JSON format.

Deck names passed through `--deck1` / `--deck2` resolve from `parity_decks/`
first, then `public/preset_decks/`. Use `--decks-dir <path>` only when you want
to override that lookup for a local experiment.

### 3. Run a custom matchup

The following command will run a single matchup between `my_deck` and itself, using a fixed seed and max turn limit. Adjust the parameters as needed.

```bash
yarn parity:test \
  -- \
  --seed 42 \
  --deck1 my_deck \
  --deck2 my_deck \
  --max-turns 10
```

`yarn parity:test` already supplies `--java-jar`, so put custom parity flags
after `--`.

## Common flags

| Flag                                | Use it when                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--deck1 <name>` / `--deck2 <name>` | Choose the two decks for the matchup.                                                                                                                                    |
| `--seed <N>`                        | Reproduce the same decisions, shuffles, and random choices.                                                                                                              |
| `--max-turns <N>`                   | Stop early once the bug has already appeared. Smaller values make runs faster.                                                                                           |
| `--games <N>`                       | Run the same matchup repeatedly with incrementing seeds starting at `--seed`.                                                                                            |
| `--verbose` / `-v`                  | Print step-by-step decisions and per-game progress for every turn.                                                                                                       |
| `--verbose=<turn>`                  | Limit verbose output to one turn, for example `--verbose=7`.                                                                                                             |
| `--verbose=<a,b>`                   | Limit verbose output to selected turns, for example `--verbose=7,8`.                                                                                                     |
| `--deep`                            | Compare callback-entry snapshots before every decision callback. Use this when a normal phase snapshot is too late to find the first drift.                              |
| `--investigate`                     | On failure, print a side-by-side Rust/Java callback window around the first divergent snapshot.                                                                          |
| `--full-log`                        | Print the full side-by-side Rust/Java callback log for the entire run. This is noisy, but useful when the important action happened well before the reported divergence. |
| `--log-snapshots`                   | Print the side-by-side snapshot timeline to stderr. Useful when checking whether snapshot ordering, rather than game state, is drifting.                                 |
| `--prefer-actions`                  | Bias the deterministic agent toward taking main-phase actions instead of passing. This can expose cast/activate bugs faster.                                             |
| `--matrix`                          | Run all selected deck pair combinations across selected seeds.                                                                                                           |
| `--seeds <list>`                    | Comma-separated seed list for matrix mode, for example `--seeds 42,100,999`.                                                                                             |
| `--decks <list>`                    | Comma-separated deck list for matrix mode.                                                                                                                               |
| `--format json`                     | Emit machine-readable output for CI or post-processing.                                                                                                                  |
| `--output <path>` / `-o <path>`     | Save the report instead of printing it to stdout.                                                                                                                        |
| `--no-cache`                        | Force Java to rerun instead of reading a cached Java trace. Use this if the Java harness or card data changed.                                                           |

## Debug examples

Run a known regression and print the local window around the first divergence:

```bash
yarn parity trigger_parity --investigate --verbose=7
```

- `trigger_parity` reads deck, seed, turn limit, and game count from
  `regression.json`.
- `--investigate` prints the nearby Rust/Java callback logs side by side.
- `--verbose=7` limits step-by-step logging to turn 7, which keeps the output
  readable when the failure is already known to happen there.

Run a custom matchup with deeper callback comparisons:

```bash
yarn parity:test \
  -- \
  --deck1 trigger_expanded \
  --deck2 comprehensive_test \
  --seed 100 \
  --max-turns 20 \
  --deep \
  --investigate
```

- `--deck1` and `--deck2` choose preset or parity deck names.
- `--seed 100` makes the run reproducible.
- `--max-turns 20` bounds the search window.
- `--deep` adds callback-entry snapshots, often moving the reported divergence
  closer to the missing rule.
- `--investigate` prints the Rust/Java callback window around that divergence.

Trace a narrow subsystem with environment variables:

```bash
FORGE_RNG_TRACE=1 FORGE_TRIGGER_TRACE=1 yarn parity trigger_parity --investigate
```

- `FORGE_RNG_TRACE=1` prints random calls on both sides when available.
- `FORGE_TRIGGER_TRACE=1` prints trigger registration and execution details in
  Rust.
- Prefix only the run you are debugging; trace env vars are intentionally noisy.

Other useful trace env vars:

| Env var                     | Use it when                                                          |
| --------------------------- | -------------------------------------------------------------------- |
| `FORGE_RNG_BT=1`            | Print Rust RNG backtraces for suspicious bounded calls.              |
| `FORGE_RNG_BT_BOUNDS=1,2,6` | Forward selected Java RNG bounded-call backtraces for those bounds.  |
| `FORGE_RNG_BT_UNBOUNDED=1`  | Forward Java unbounded RNG backtraces.                               |
| `FORGE_SORT_TRACE=1`        | Trace Java ordering/sorting decisions forwarded through the harness. |
| `FORGE_STACK_TRACE=1`       | Trace Rust stack casting and resolution paths.                       |
| `FORGE_PAYMENT_TRACE=1`     | Trace Rust mana payment decisions.                                   |
| `FORGE_CARD_TRACE=<name>`   | Trace Rust card lookup/details for matching card names.              |
| `FORGE_LIB_DUMP=1`          | Ask the Java harness to dump library details.                        |
| `FORGE_TOKEN_DEBUG=1`       | Ask the Java harness to print token diagnostics.                     |
