---
name: runparity
description: Run Java/Rust parity tests from the regression suite or custom configurations
license: MIT
compatibility: opencode
metadata:
  audience: developers
  workflow: testing
---

## What I do

- Ensure the Java harness JAR is up-to-date before running tests (auto-rebuild if sources changed)
- Run parity tests that compare the Rust engine against the Java Forge engine using deterministic RNG
- Execute named tests from the regression suite in `forge-engine/crates/forge-parity/regression.json`
- Run custom one-off parity tests with specific decks, seeds, and parameters
- Report pass/fail results and explain divergences when tests fail

## When to use me

Use this when:
- You want to run one or more regression parity tests
- You want to run a custom parity test with specific decks/seeds/options
- You need to verify a code change didn't break existing parity
- You modified Java source files and need to rebuild the harness before testing

## How I work

### Step 1: Check and rebuild the Java harness if needed

**Always run this before any parity test.** The script computes a SHA-256 checksum of all Java source files and pom.xml files across the 5 modules the harness depends on (`forge-core`, `forge-game`, `forge-ai`, `forge-gui`, `forge-harness`) and compares against a stored checksum. If anything changed (or the JAR doesn't exist, or no stored checksum is found), it rebuilds automatically.

```bash
node scripts/harness.mjs ensure
```

This will either print `harness: JAR is up-to-date` (no rebuild needed) or `harness: rebuilding JAR...` followed by `harness: rebuild complete` on success. Use a **300000ms timeout** for this command since Maven builds can take several minutes.

If the rebuild fails, stop and report the Maven error to the user. Do not proceed to run parity tests with a stale JAR.

To check staleness without rebuilding (useful for diagnostics):
```bash
node scripts/harness.mjs check
# exit 0 = up-to-date, exit 1 = stale/missing
```

### Step 2: Determine what to run

- If a **test name** is provided (e.g., `/runparity keyword_advanced`), run that named test with `yarn parity <test-name>`.
- If **custom args** are provided (e.g., `/runparity --deck1 red_burn --deck2 green_stompy --seed 42`), run `yarn parity:test <args>`.
- If **"all"** or **"regression"** is specified, read `forge-engine/crates/forge-parity/regression.json` and run each entry sequentially with `yarn parity <name>`. Use a 300000ms timeout per test.
- If no arguments are given, ask what to run.

### Step 3: Run the tests

Named regression test:
```bash
yarn parity <test-name>
```

Custom parity test (passes args directly to the forge-parity binary):
```bash
yarn parity:test <args>
```

Common custom flags: `--deck1`, `--deck2`, `--seed`, `--games`, `--max-turns`, `--matrix`, `--seeds`, `--decks`.

### Step 4: Report results

- Summarize total pass/fail/error counts.
- For **failures**: show the first divergence point -- quote the Rust vs Java lines and the game state snapshot before divergence.
- For **passes**: just confirm they passed.

### Interpret failures

When a test fails, briefly explain the likely cause based on the divergence pattern:
- **One engine has an action the other doesn't**: mana availability or canPlay/target check divergence.
- **Same options but different choice**: auto-tapper tapped different lands, causing silent state drift.
- **Phase mismatch**: phase handler logic differs between engines.
- **Extra/missing decision**: trigger registration or priority flow difference.

## Prerequisites

The Rust engine must compile. If it doesn't, run `cargo check -p forge-parity` and fix errors first.

The Java harness rebuild is handled automatically by `scripts/harness.mjs` (see Step 1). You should never need to manually run `mvn package`.

## Key files

- **Harness rebuild script**: `scripts/harness.mjs`
- Regression test definitions: `forge-engine/crates/forge-parity/regression.json`
- Parity script: `scripts/parity.mjs`
- Parity binary: `forge-engine/crates/forge-parity/src/main.rs`
- Preset decks: `src-tauri/src/game_manager.rs`

## Watched Java source directories

These are the directories that `harness.mjs` monitors for changes:

- `forge/forge-core/src/` -- core card definitions, rules primitives
- `forge/forge-game/src/` -- full game engine
- `forge/forge-ai/src/` -- AI decision logic
- `forge/forge-gui/src/` -- GUI base classes, asset resolution
- `forge-harness/src/` -- harness entry point, JSONL protocol, deterministic controllers
