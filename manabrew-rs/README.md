#manabrew-engine

`manabrew-engine/` is the Rust workspace for the `manabrew` rules engine,
runtime, parity tooling, WebAssembly bridge, and self-hosted services.

The engine is a GPL Rust port of Forge's Java rules engine. Java Forge remains
the behavioral reference, while the Rust implementation adds the runtime shape
needed for Tauri, web/WASM, self-hosted rooms, parity testing, and typed
internal representations of high-risk Forge script semantics.

For public project positioning, start with:

- [../README.md](../README.md)
- [../docs/PARITY_AND_IR.md](../docs/PARITY_AND_IR.md)
- [../docs/PARITY_TESTING.md](../docs/PARITY_TESTING.md)

## Workspace Map

All crates live under `manabrew-rs/crates/`.

| Crate                      | Purpose                                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `forge-foundation`         | Core shared types: colors, mana, card types, zones, phases.                                                           |
| `forge-card-script`        | Parsed Forge card-script IR shared by parser and engine code.                                                         |
| `forge-cardset-archive`    | Precompiled cardset archive format for faster packaged startup.                                                       |
| `forge-carddb`             | Loads Forge card scripts into card definitions, with archive fast-path support.                                       |
| `manabrew-engine-macros`   | Build-time proc macros. No runtime game logic.                                                                        |
| `manabrew-engine`          | Rust rules engine: game state, turn loop, combat, stack, abilities, triggers, replacements, statics, costs, and mana. |
| `manabrew-agent-interface` | Prompt/action DTO layer between the engine and UI, AI, or network agents.                                             |
| `manabrew-game-runtime`    | Session host glue over message transports.                                                                            |
| `parity`                   | Differential harness that runs Rust and Java Forge side by side and compares traces.                                  |
| `manabrew-server`          | Self-hosted room, lobby, relay, and parity-dashboard services.                                                        |
| `wasm`                     | wasm-bindgen bridge for browser builds.                                                                               |
| `self-hosted-node`         | Headless engine host for self-hosted rooms and automation.                                                            |

Dependency direction is intentionally narrow:

```text
foundation, card-script, cardset-archive
  -> carddb
  -> engine
  -> runtime / wasm / server / parity / clients
```

Do not introduce dependency cycles. Shared concepts should move downward only
when they are truly engine-independent.

## Engine Layout

The main rules engine crate is:

```text
manabrew-rs/crates/manabrew-engine/
```

Important modules:

| Module                            | What it owns                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `game.rs`, `core.rs`, `action.rs` | Central game state, state-based actions, top-level mutations.                           |
| `game_loop/`                      | Turn driver, priority loop, stack resolution, phase handling, legal-action enumeration. |
| `ability/`                        | SpellAbility factory, API dispatch, and ability IR.                                     |
| `ability/effects/`                | Effect resolvers for Forge `SP$`, `AB$`, and `DB$` APIs.                                |
| `trigger/`                        | Triggered abilities and Forge `Mode$` handling.                                         |
| `replacement/`                    | Replacement effects and replacement callsites.                                          |
| `staticability/`                  | Continuous effects and layer handling.                                                  |
| `cost/`                           | Cost framework, payment, and decision-maker support.                                    |
| `combat/`                         | Attack/block declaration, restrictions, and damage assignment.                          |
| `mana/`                           | Mana pools, production, payment, and autopay support.                                   |
| `card/`                           | Card instances, card state, tokens, and card factory logic.                             |
| `player/`                         | Player state, predicates, controller logic, and typed player actions.                   |
| `agent/`                          | PlayerAgent trait and helpers. The engine asks agents for decisions.                    |
| `parsing/`                        | Engine-side parsers and compiled helpers for Forge DSL values.                          |
| `svar/`                           | SVar evaluation and late-bound SVar resolution helpers.                                 |

Most parity fixes should land in the module that mirrors the Java Forge owner of
the same mechanic. For example, an effect bug usually belongs in
`ability/effects/`, a trigger bug in `trigger/` or `game_loop/trigger_handler`,
and a replacement bug in `replacement/` plus the relevant callsite.

## Forge Compatibility

The Rust engine consumes Forge card scripts and mirrors Java Forge behavior.
That compatibility has two layers:

- **Behavioral parity:** same decks, same seed, same deterministic choices,
  compared against Java Forge by `parity`.
- **Script compatibility:** Forge card scripts remain the source format, while
  Rust gradually lowers high-risk string domains into typed IR.

Typed IR is an implementation detail. It should make the engine easier to audit
and faster to run without changing game behavior. SVar resolution remains
late-bound: the engine resolves an SVar from the current host-card state when it
is needed, not eagerly at card load time.

## Java Forge Backend

The modern client/runtime stack can also drive a Java Forge-backed session. That
path lets users play through the Tauri/web/self-hosted-room experience while the
Rust engine continues moving toward parity.

The Java backend path and the Rust parity path share infrastructure, but they
serve different purposes:

- Java backend: play actual Forge-backed games through the modern stack.
- Rust parity: port mechanics into Rust and verify them against Java Forge.

## Common Commands

Run commands from the repository root unless noted otherwise.

```bash
# Build the Java Forge harness used by parity and Java backend work
yarn build:harness

# Run a custom parity matchup
yarn parity:test -- --deck1 red_burn --deck2 green_stompy --seed 42 --max-turns 20

# Run the parity debugger UI
yarn parity:gui

# Check selected Rust crates
cargo check -pmanabrew-engine
cargo check -pparity

# Full repository lint/type/format gate
yarn lint:all
```

See [../docs/PARITY_TESTING.md](../docs/PARITY_TESTING.md) for detailed parity
commands.

## Contributor Notes

For engine work:

1. Reproduce the divergence with `yarn parity` or `yarn parity:test`.
2. Read the matching Java Forge file under `../forge/forge-game/`.
3. Patch the Rust module that mirrors the Java owner.
4. Re-run the failing parity command.
5. Broaden verification if the mechanic is shared.

Do not add card-specific fixes for general mechanics. If a fix appears to need a
special case for one card, look for the Forge rule that card is exercising.

Internal agent workflow notes live in [AGENTS.md](./AGENTS.md). They are useful
for maintainers and coding agents, but this README is the public workspace
overview.
