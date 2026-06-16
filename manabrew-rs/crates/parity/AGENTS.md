# Parity harness

Differential testing: runs the Rust engine and the Java Forge engine on the same deck/seed and compares decision-by-decision. The home base for parity bug investigation.

Read first: `/AGENTS.md`, `docs/agents/ENGINE_BUGFIX_WORKFLOW.md`, `docs/PARITY_TESTING.md`.

## Layout

| File / folder                                                       | Role                                                                                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `regression.json`                                                   | The canonical regression suite. Each entry: deck1, deck2, seed, max_turns, games. `yarn parity <name>` looks up entries here.                    |
| `parity_ignore.json`                                                | Known-divergent matchups to skip, with a written reason.                                                                                         |
| `src/runner.rs`, `src/scheduler.rs`                                 | Top-level orchestration.                                                                                                                         |
| `src/deterministic_agent.rs`                                        | The reproducible agent both engines drive. Same logic, same RNG, same decisions.                                                                 |
| `src/java_bridge.rs`, `src/java_cache.rs`, `src/java_random.rs`     | Java harness FFI — calls into `forge-harness/`.                                                                                                  |
| `src/runtime.rs`                                                    | Shared Rust/Java matchup runtime. CLI, CI/server mode, and debugger tooling should use this instead of growing separate engine scheduling logic. |
| `src/comparator.rs`, `src/snapshot.rs`                              | Trace comparison and per-phase snapshots.                                                                                                        |
| `src/parity_log.rs`, `src/log_buffer.rs`, `src/callback_fmt.rs`     | Divergence reporting.                                                                                                                            |
| `src/choice_space.rs`, `src/combat_choice_space.rs`                 | Legal-action enumeration mirrored against Java.                                                                                                  |
| `src/parity_card_map.rs`, `src/parity_id.rs`, `src/parity_order.rs` | Cross-engine identity bridging (card name ↔ id).                                                                                                 |
| `src/deck_generator.rs`, `src/card_pool.rs`                         | Deck construction for matrix runs.                                                                                                               |
| `src/bin/`, `src/tools/`, `src/utils/`, `src/infra/`                | CLI binaries, debugging tools, shared utilities.                                                                                                 |

`parity` is the single built binary for parity infrastructure. CI queue client commands live under `parity ci-client <health|submit|poll>` rather than a separate `parity-ci` executable.

## Deck directories

Deck names passed via `--deck1` / `--deck2` resolve from two folders in order:

1. `parity_decks/` — canonical home for decks referenced by `regression.json`. Land new regression decks here.
2. `public/preset_decks/` — wider preset library shared with the web build (UI, `yarn import-deck` landing zone). Decks here are still resolvable by name for ad-hoc parity runs.

Both engines share this lookup: the Rust list lives in `runner::DEFAULT_DECKS_DIRS`; the Java harness reads it via `-Dpreset.decks.dir=parity_decks,preset_decks` (set automatically by `java_bridge::decks_dir_property`). `--decks-dir <path>` still overrides with a single explicit folder for tests/debugging.

## Common workflows

### Reproduce a divergence

```bash
yarn parity <test-name>
# verbose:
yarn parity:test -- --deck1 <d1> --deck2 <d2> --seed <N> --max-turns 30 -v
```

Trace flags: `FORGE_RNG_TRACE=1`, `FORGE_TRIGGER_TRACE=1`, `FORGE_LIFE_TRACE=1`. See `docs/PARITY_TESTING.md` for the full env-var list.

The parity binary mmaps `src-tauri/resources/cardset.rkyv` at startup. `yarn parity` ensures it's present, but direct invocations (`cargo run -p parity …`, manual `./target/parity/parity …`, custom CI jobs) need to materialise it first — see `manabrew-engine/AGENTS.md` § "Cardset archive". A bare `cargo build` of this crate doesn't build it.

Parity workflows build with `--profile parity` (release + `debug-assertions`), output dir `target/parity/`, so the dual-evaluation drift guards in the engine stay active during parity runs. Compiled-vs-legacy selector drift is reported as `[selector-drift]` lines (once per selector); set `FORGE_SELECTOR_ASSERT=1` to make it panic at the divergence site instead.

### Add a regression entry

After fixing a bug, lock the fix in. Add to `regression.json`:

```json
{
  "name": "descriptive_kebab_case_name",
  "deck1": "<deck>",
  "deck2": "<deck>",
  "seed": 42,
  "max_turns": 20,
  "games": 1
}
```

Pick the smallest seed/turn budget that reliably triggers the bug. The matrix runs 3 seeds × 7 decks = 126 matchups, so one entry per regression is enough.

### Skip a known-divergent matchup

Edit `parity_ignore.json`. Every entry needs a written reason. Don't ignore a divergence to make CI green — investigate first.

## Conventions

- **Both engines share an RNG seed.** Anything that consumes randomness must be threaded through `game_rng` (Rust) and the matching `MyRandom` path (Java). New RNG callsites that drift cause every downstream divergence.
- **Card identity is by name, not id.** Internal IDs differ between engines. The comparator sorts by name.
- **Snapshots are taken at phase transitions.** If a divergence is reported "in upkeep of turn 3", look at the upkeep handler, not later phases.
- **The Java harness API surface is stable.** `forge-harness/` is ours, but its API is consumed cross-language; changing a method signature breaks every parity test. Add new methods, don't rename existing ones.

## When the harness itself is broken

If divergence reports look wrong (e.g. spurious differences in unrelated fields), suspect:

- A new field in `snapshot.rs` / `comparator.rs` that's non-deterministic across engines.
- A change to the Java harness that didn't propagate to the JAR (`yarn build:harness`).
- A `FORGE_*_TRACE` env var leaking ordering information into the snapshot.

Rebuild the harness and rerun before assuming the engine is wrong.
