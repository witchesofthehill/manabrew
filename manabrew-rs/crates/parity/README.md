#parity

Cross-engine differential testing tool that compares the Rust Forge engine against the Java reference implementation snapshot-by-snapshot.

## Building

```bash
# Default — matrix/fuzz/single-game modes only
cargo build -pparity

# With SQLite persistence (enables --continuous)
cargo build -p parity --features storage

# With web dashboard (enables --serve, implies storage)
cargo build -p parity --features serve
```

`parity` is the single binary for parity infrastructure. CI queue client commands are exposed as a mode:

```bash
parity ci-client health --server http://localhost:8080
parity ci-client submit --server http://localhost:8080 --file regression.json
parity ci-client poll --server http://localhost:8080 --batch-id 1
```

For the Java harness (required for full parity mode):

```bash
cd forge-harness
mvn package -DskipTests
```

## Usage

### Rust-only mode (default)

Runs the Rust engine and dumps per-phase JSONL snapshots. Useful for debugging and golden file generation.

```bash
cargo run -p parity -- --deck1 red_burn --deck2 green_stompy
```

### Full parity mode

Runs both engines with identical inputs and compares snapshots field-by-field.

```bash
cargo run -p parity -- \
  --deck1 red_burn --deck2 green_stompy \
  --java-jar forge-harness/target/forge-harness-jar-with-dependencies.jar
```

### Matrix mode

Runs all deck pair combinations across multiple seeds in parallel (uses rayon).

```bash
cargo run -p parity -- --matrix \
  --java-jar forge-harness/target/forge-harness-jar-with-dependencies.jar
```

### Continuous mode (requires `--features storage`)

Runs games in a round-robin pattern across preset deck pairs, stores results in SQLite, and exits with a pass/fail code based on a configurable threshold. Designed for CI.

```bash
cargo run -p parity --features storage -- --continuous \
  --max-games 100 --threshold 0.90 --db-path parity.db \
  --java-jar forge-harness/target/forge-harness-jar-with-dependencies.jar
```

After the run, query the database directly:

```bash
sqlite3 parity.db "SELECT status, COUNT(*) FROM runs GROUP BY status"
```

### Serve mode (requires `--features serve`)

Same as continuous mode but also starts a web dashboard with real-time stats, trend charts, a deck pair heatmap, and failure details.

```bash
cargo run -p parity --features serve -- --serve --port 8080 \
  --java-jar forge-harness/target/forge-harness-jar-with-dependencies.jar
```

Then open `http://localhost:8080` in a browser. The dashboard auto-refreshes every 10 seconds. Pass `--max-games N` to stop after N games, or omit it to run indefinitely.

### CI client mode

Talks to a running `--serve --ci` parity server from the same `parity` binary.

```bash
cargo run -p parity --features serve -- ci-client health --server http://localhost:8080
```

## Flags

| Flag                     | Default           | Description                                                                               |
| ------------------------ | ----------------- | ----------------------------------------------------------------------------------------- |
| `--deck1 <name>`         | `red_burn`        | Preset deck for player 1                                                                  |
| `--deck2 <name>`         | `green_stompy`    | Preset deck for player 2                                                                  |
| `--seed <N>`             | `42`              | RNG seed for reproducibility                                                              |
| `--games <N>`            | `1`               | Number of games in single-match mode; uses seeds `seed..seed+N-1`                         |
| `--max-turns <N>`        | `10`              | Maximum turns before stopping                                                             |
| `--java-jar <path>`      | _(none)_          | Path to Java harness JAR (enables parity mode)                                            |
| `--cards-dir <path>`     | _(none)_          | Path to Forge card scripts directory                                                      |
| `--decks-dir <path>`     | _(see note)_      | Single deck folder override. Default search: `parity_decks/` then `public/preset_decks/`. |
| `--output <path>` / `-o` | _(stdout)_        | Write report to file instead of stdout                                                    |
| `--format <fmt>`         | `text`            | Output format: `text` or `json`                                                           |
| `--verbose` / `-v`       | `false`           | Print step-by-step logs (agent decisions, Java snapshots, per-game progress)              |
| `--prefer-actions`       | `false`           | Bias random main-phase choices toward play/activate actions over pass                     |
| `--matrix`               | `false`           | Run all deck pairs × seeds                                                                |
| `--seeds <list>`         | `42,100,999`      | Comma-separated seeds for matrix mode                                                     |
| `--decks <list>`         | _(all presets)_   | Comma-separated deck names for matrix/continuous mode                                     |
| `--fuzz`                 | `false`           | Generate random decks from the parseable card pool                                        |
| `--iterations <N>`       | `100`             | Number of fuzz iterations                                                                 |
| `--master-seed <N>`      | `42`              | Master seed for fuzz reproducibility                                                      |
| `--java-workers <N>`     | _(auto)_          | Number of Java server worker processes                                                    |
| `--continuous`           | `false`           | Run continuous parity testing with SQLite storage (requires `storage` feature)            |
| `--serve`                | `false`           | Start web dashboard alongside continuous testing (requires `serve` feature)               |
| `--max-games <N>`        | `100` / unlimited | Max games for continuous/serve mode (unlimited if omitted in serve mode)                  |
| `--threshold <F>`        | `0.90`            | Pass rate threshold (0.0–1.0); exit 1 if below (continuous mode)                          |
| `--db-path <path>`       | `parity.db`       | SQLite database path for continuous/serve mode                                            |
| `--port <N>`             | `8080`            | HTTP port for serve mode                                                                  |
| `--fuzz-per-batch <N>`   | `0`               | Fuzz games per preset batch in continuous mode (0 to disable)                             |

## Available preset decks

| Deck                   | Focus                                     |
| ---------------------- | ----------------------------------------- |
| `red_burn`             | Direct damage spells, haste creatures     |
| `green_stompy`         | Big creatures, fight effects              |
| `white_aggro`          | Small creatures, tokens, lifegain         |
| `black_control`        | Removal, discard, sacrifice               |
| `blue_control`         | Counterspells, draw, bounce               |
| `comprehensive_test`   | Mixed card types for broad coverage       |
| `zone_change``         | ETB/LTB/dies triggers, zone movement      |
| `token_swarm`          | Token generation and anthem effects       |
| `library_manipulation` | Scry, surveil, tutors                     |
| `green_fight`          | Fight and bite effects                    |
| `mass_effects`         | Board wipes, mass pump                    |
| `trigger_test`         | Core trigger types                        |
| `keyword_test`         | Keyword abilities (flying, trample, etc.) |
| `trigger_expanded`     | Extended trigger coverage (68 types)      |

## Common commands

```bash
# Quick smoke test — Rust only
cargo run -pparity

# Full parity check with a specific seed
cargo run -p parity -- \
  --deck1 trigger_expanded --deck2 comprehensive_test --seed 42 \
  --java-jar forge-harness/target/forge-harness-jar-with-dependencies.jar

# Run multiple parity games with incrementing seeds (42..141)
cargo run -p parity -- \
  --deck1 trigger_expanded --deck2 comprehensive_test \
  --games 100 --seed 42 --max-turns 30 \
  --java-jar forge-harness/target/forge-harness-jar-with-dependencies.jar

# Same run, but with per-step logging enabled
cargo run -p parity -- \
  --deck1 trigger_expanded --deck2 comprehensive_test \
  --games 100 --seed 42 --max-turns 30 --verbose \
  --java-jar forge-harness/target/forge-harness-jar-with-dependencies.jar

# JSON output for CI
cargo run -p parity -- \
  --deck1 red_burn --deck2 green_stompy --format json \
  --java-jar forge-harness/target/forge-harness-jar-with-dependencies.jar

# Matrix — all decks, custom seeds, save report
cargo run -p parity -- --matrix --seeds 42,100,200,300 \
  --java-jar forge-harness/target/forge-harness-jar-with-dependencies.jar \
  -o parity-report.txt

# Matrix — specific decks only
cargo run -p parity -- --matrix \
  --decks red_burn,green_stompy,white_aggro \
  --java-jar forge-harness/target/forge-harness-jar-with-dependencies.jar

# Verbose mode — see every agent decision
cargo run -p parity -- -v --deck1 trigger_test --deck2 keyword_test

# Rust-only with more turns
cargo run -p parity -- --deck1 black_control --deck2 blue_control --max-turns 20

# Continuous — CI mode, 50 games, 90% pass threshold
cargo run -p parity --features storage -- --continuous \
  --max-games 50 --threshold 0.90 --db-path ci-parity.db \
  --decks red_burn,green_stompy,white_aggro \
  --java-jar forge-harness/target/forge-harness-jar-with-dependencies.jar

# Continuous with fuzz — 3 random-deck games per preset batch
cargo run -p parity --features storage -- --continuous \
  --max-games 100 --fuzz-per-batch 3 \
  --java-jar forge-harness/target/forge-harness-jar-with-dependencies.jar

# Serve — long-lived dashboard, runs forever until stopped
cargo run -p parity --features serve -- --serve --port 8080 \
  --java-jar forge-harness/target/forge-harness-jar-with-dependencies.jar
```

## Exit codes

- `0` — All snapshots match (parity pass), Rust-only completed, or continuous pass rate meets threshold
- `1` — Divergence detected, engine error, or continuous pass rate below threshold

## Feature flags

| Feature   | Dependencies added                | Enables                                 |
| --------- | --------------------------------- | --------------------------------------- |
| `storage` | rusqlite, chrono                  | `--continuous` mode, SQLite persistence |
| `serve`   | storage + tokio, axum, tower-http | `--serve` mode, web dashboard           |

The default build (no features) has zero additional dependencies and supports all existing modes (rust-only, parity, matrix, fuzz).

## Web dashboard

When running in `--serve` mode, the dashboard at `http://localhost:<port>` provides:

| Endpoint                              | Description                                          |
| ------------------------------------- | ---------------------------------------------------- |
| `GET /`                               | Single-page dashboard with auto-refresh              |
| `GET /api/stats`                      | Current pass rate, total games, uptime, games/minute |
| `GET /api/trend?bucket=hour&limit=24` | Time-series pass rate by hour or day                 |
| `GET /api/failures?limit=50`          | Recent failures with divergence details              |
| `GET /api/matrix`                     | Pass rate heatmap by deck1 × deck2                   |
| `GET /api/run/:id`                    | Full details for a specific run                      |

## Docker

The parity dashboard can be run alongside the manabrew-server using Docker Compose:

```bash
# From manabrew-rs/crates/manabrew-server/
docker compose up parity-dashboard -d

# View logs
docker compose logs -f parity-dashboard

# Stop
docker compose down parity-dashboard
```

The dashboard will be at `http://localhost:8080`. The SQLite database persists in a named volume (`parity-data`).

To configure, edit environment variables in `compose.yml` or pass overrides:

```bash
# Run with 500 games max and a specific set of decks
MAX_GAMES=500 DECKS=red_burn,green_stompy docker compose up parity-dashboard -d
```

| Variable         | Default         | Description                 |
| ---------------- | --------------- | --------------------------- |
| `PORT`           | `8080`          | Dashboard HTTP port         |
| `THRESHOLD`      | `0.90`          | Pass rate threshold         |
| `MAX_TURNS`      | `10`            | Max turns per game          |
| `MAX_GAMES`      | _(unlimited)_   | Stop after N games          |
| `FUZZ_PER_BATCH` | `0`             | Fuzz games per preset batch |
| `DECKS`          | _(all presets)_ | Comma-separated deck names  |
| `EXTRA_ARGS`     | _(none)_        | Additional CLI flags        |

## Coverage report

For single-match runs (`--games N` with fixed `--deck1`/`--deck2`) in text mode, the report ends with:

- total unique deck-card coverage across the run
- uncovered card names (cards in the specified deck lists that were never played/cast)
- per-game completion status in the table (`FINISHED TURN X` or `STOPPED AT MAX`)
- low-effort ability/effect/trigger signal list inferred from agent `notify` messages
