# Rust engine workspace

This is the Rust port of Forge's Java rules engine. Read the root `/AGENTS.md` first, plus `docs/agents/PARITY_PHILOSOPHY.md`. Most parity work bottoms out here.

## Required reading: the DSL spec

Card scripts are the source of truth for behavior; the engine evaluates them. Before any work that touches abilities, triggers, replacements, static abilities, costs, the stack, SVars, selectors, or layered effects, read:

- **`docs/forge-dsl-semantics.md`** — runtime model: execution pipeline, stack semantics, targeting, cost payment, layer system, SVar resolution, determinism invariants, known CR deviations.
- **`docs/forge-dsl-grammar.md`** — syntax / parsing model. Read this when working on the parser, the IR, or interpreting an unfamiliar param.

When you write or change engine logic, write IRs and resolution code that mirror the semantics in the spec exactly. If your implementation diverges from the spec, either the implementation is wrong or the spec needs updating — don't silently drift.

## Crate map

All under `forge-engine/crates/`:

| Crate                   | Role                                                                                                                                                              | Java mirror                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `forge-foundation`      | Pure types: colors, mana, card types, zones, phases. No I/O.                                                                                                      | `forge/forge-core/`                          |
| `forge-card-script`     | Card script IR shared between parser and engine.                                                                                                                  | —                                            |
| `forge-cardset-archive` | rkyv archive format for the pre-compiled cardset, plus a `build-cardset-archive` binary. Consumed by `forge-carddb` for ~6× faster cold start in packaged builds. | —                                            |
| `forge-carddb`          | Parses Forge's 32K+ `.txt` card scripts into `CardRules`, with an rkyv fast-path via `forge-cardset-archive`. WASM-safe (no `std::fs`).                           | `forge/forge-game/.../CardRules.java` etc.   |
| `forge-engine-macros`   | Build-time proc macros. No runtime logic.                                                                                                                         | —                                            |
| **`forge-engine`**      | The rules engine. Game state, turn loop, combat, stack, abilities, replacements, triggers, statics, costs, mana.                                                  | `forge/forge-game/src/main/java/forge/game/` |
| `forge-agent-interface` | DTO layer between the engine and any agent (UI, AI, network). Defines the prompt protocol.                                                                        | —                                            |
| `forge-game-runtime`    | Hosts an N-player game session over a caller-supplied transport. `host_runtime::run_hosted_multiplayer_game` is the single source of truth for the multiplayer setup-and-run dance (Tauri uses mpsc, WASM uses SharedArrayBuffer — both supply their transport via closures). | —                                            |
| `forge-parity`          | Differential test harness — runs Rust and Java side-by-side and compares. See its own AGENTS.md.                                                                  | —                                            |
| `forge-server`          | Standalone matchmaking/lobby server. Optional.                                                                                                                    | —                                            |
| `forge-wasm`            | wasm-bindgen exports for browser builds.                                                                                                                          | —                                            |
| `self-hosted-node`      | Headless engine node (AI bots, automation).                                                                                                                       | —                                            |

Dependency direction: `foundation`, `card-script`, `cardset-archive` ← `carddb` ← `engine` ← everything else. Don't introduce cycles.

## `forge-engine` crate — module map

The engine itself lives at `forge-engine/crates/forge-engine/src/`. Each module mirrors a Java package under `forge/forge-game/src/main/java/forge/game/`.

| Module                                    | What it owns                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `game.rs`, `core.rs`, `action.rs`         | Central `Game` state, state-based actions, top-level mutations.                                                     |
| `game_loop/`                              | Turn driver, priority loop, stack resolution, phase handler, action_space (legal-action enumeration). The hot path. |
| `phase/`                                  | Phase types, extra phases, extra turns, untap step.                                                                 |
| `ability/`                                | `SpellAbility` factory, IR, dispatch. `api_type.rs` lists every supported `SP$/AB$/DB$` API.                        |
| `ability/effects/`                        | The 200+ `*_effect.rs` resolvers. **Most parity bugs land here.** Has its own AGENTS.md.                            |
| `spellability/`                           | `SpellAbility` family — targeting, restrictions, conditions, optional costs.                                        |
| `staticability/`                          | Continuous/static effects with the CR 613 layer system.                                                             |
| `replacement/`                            | Replacement effects (37 types). Each `replace_*.rs` provides `can_replace` + `execute` + a callsite into the loop.  |
| `trigger/`                                | Triggered abilities (~120 `trigger_*.rs`). Each maps to a Forge `Mode$`.                                            |
| `cost/`                                   | Cost framework (`CostX` family), payment, decision-maker, visitor.                                                  |
| `combat/`                                 | Attack/block declaration, constraints, damage assignment.                                                           |
| `mana/`                                   | Mana pool, payment, conversion matrix, auto-pay.                                                                    |
| `card/`                                   | `CardInstance`, collections, perpetual effects (`perpetual/`), tokens (`token/`), card factory.                     |
| `player/`                                 | `PlayerState`, life, statistics, predicates, controller, plus `actions/` (typed player actions).                    |
| `zone/`                                   | `MagicStack`, cost-payment stack. (Zone _types_ live in `forge-foundation`.)                                        |
| `keyword/`                                | Static keywords (Flying, Trample, Suspend, Kicker, Modular, …). One file per keyword.                               |
| `agent/`                                  | `PlayerAgent` trait and helpers. The engine never decides — it asks the agent.                                      |
| `parsing/`                                | Engine-side parsers (amount expressions, comparators, key/value). Distinct from `forge-carddb`.                     |
| `svar/`                                   | Forge SVar evaluator (variables embedded in scripts).                                                               |
| `mulligan/`                               | Opening hand / London mulligan.                                                                                     |
| `lki.rs`, `game_snapshot.rs`, `game_log*` | Bookkeeping: last-known-info, snapshots, log entries.                                                               |

## Symptom → folder

Use this when a parity report points at a specific failure mode:

| Symptom                                        | Likely folder                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Wrong life total / wrong damage                | `replacement/` (prevention/redirection), `combat/`, `ability/effects/damage_*`                 |
| Trigger fires when it shouldn't / doesn't fire | `trigger/`, `game_loop/trigger_handler.rs`, `staticability/static_ability_disable_triggers.rs` |
| Continuous effect (anthem, protection) wrong   | `staticability/` + `staticability/layer.rs`                                                    |
| Cost paid incorrectly                          | `cost/`, `game_loop/cost_payment.rs`, `mana/`                                                  |
| Spell resolves wrong                           | `ability/effects/<api>_effect.rs`                                                              |
| Attack/block illegal or missing                | `combat/attack_constraints.rs`, `combat/attack_restriction*.rs`                                |
| Zone change misroutes                          | `replacement/replace_moved.rs`, `ability/effects/change_zone_effect/`                          |
| Wrong card available to play                   | `game_loop/playability.rs`, `card/card_play_option.rs`                                         |

## Conventions

- **Mirror Java exactly.** See `docs/agents/PARITY_PHILOSOPHY.md`.
- **One Forge concept per file.** New effects, triggers, replacements, statics, keywords each get their own file named after the Java class, registered in their module's `mod.rs`.
- **`Game` owns everything.** All mutation flows through `&mut Game`. No interior mutability, no shared references.
- **Crate-wide `#![allow(...)]`s in `lib.rs` are intentional.** They document parity trade-offs.
- **Minimize SVar parsing — this is critical.** SVar resolution is late-bound by spec (`docs/forge-dsl-semantics.md` §5.2). Resolve SVars at the call site, lazily, and only for the SVar the engine actually needs. Do not eagerly walk the SVar graph at card construction or ability registration time. Do not pre-expand sub-ability chains into IR before they are reached. Do not re-parse the same SVar string on every reference — parse once, then reuse the parsed form. Aggressive eager parsing inflates load time, breaks the lazy semantics the spec relies on, and produces stale IR when card state changes (transform, copy, exile) alter the available SVars per invariant §10.7.

## Build & test

```bash
cargo build --workspace
cargo test --workspace
cargo check -p forge-engine
yarn parity <test-name>          # see forge-parity AGENTS.md
yarn scan                         # Java vs Rust file coverage
```

## Cardset archive

Every engine entrypoint (Tauri runtime, parity binary, self-hosted node, debugger) mmaps a single rkyv archive at startup: `src-tauri/resources/cardset.rkyv`. It bundles cards, tokens, editions, and block data. Path override: `CARDSET_ARCHIVE` env var. The web build has its own copy at `public/wasm/cardset.v4.rkyv` produced by `yarn build:wasm`.

**Who builds it:**

| Trigger                                                                                                   | Output path                                  |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `cargo build -p manabrew` (Tauri) — runs `src-tauri/build.rs`                                             | `src-tauri/resources/cardset.rkyv`           |
| `cargo run -p forge-cardset-archive --features build --release --bin build-cardset-archive` (manual / CI) | `src-tauri/resources/cardset.rkyv` (default) |
| `yarn build:wasm` — runs the bin then copies into `public/wasm/`                                          | `public/wasm/cardset.v4.rkyv`                |

`src-tauri/build.rs::needs_rebuild` checks both data-dir mtimes _and_ calls `forge_cardset_archive::load_checked()` on the existing file. A schema change in `forge-cardset-archive` (struct field added, reorder, type change) breaks `load_checked`, forcing a rebuild even when the source data is untouched. Without that guard, a stale archive on disk would survive a schema bump and panic at runtime with `pointer out of bounds`.

**CI gotcha:** workflows that build a single non-Tauri crate (`forge-parity`, `self-hosted-node`, etc.) never trigger `src-tauri/build.rs`, so the archive isn't produced. Without an explicit build step they start up and panic with `Cardset archive not found at src-tauri/resources/cardset.rkyv`. All three parity workflows (`parity-self-hosted`, `parity-continuous`, `parity_ripper`) now have a `Build cardset archive` step before invoking the binary. Add the same step to any new workflow or local script that runs engine binaries directly.

**DFC name lookups:** `CardDatabase::get_by_card_name` first tries the full string, then on miss splits at `" // "` and retries with just the front face. Split cards (`"Fire // Ice"`, stored as the full name) hit on the first attempt; Scryfall-style DFC names (`"Fable of the Mirror-Breaker // Reflection of Kiki-Jiki"`) resolve via the fallback. Deck imports that come straight from Scryfall don't need pre-processing for the engine.
