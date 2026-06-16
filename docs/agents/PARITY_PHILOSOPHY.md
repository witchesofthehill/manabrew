# Parity philosophy

The Rust engine targets **1:1 behavioral parity** with the Java Forge engine in `forge/forge-game/`. Java is the source of truth.

## What we mirror

- **File names.** `ChangeZoneEffect.java` → `change_zone_effect.rs`. Snake_case the class name, keep the suffix.
- **Module layout.** `forge/game/ability/effects/` → `manabrew-rs/crates/manabrew-engine/src/ability/effects/`. New folders only when Java has them.
- **Symbol names.** Methods, structs, enum variants — same names in Rust idiom (snake_case methods, PascalCase types). Don't rename for "Rust style" if it breaks the trail back to Java.
- **Behavior.** Given the same inputs (same deck, same seed, same agent), both engines must produce the same trace.

## What we accept as a cost

- **Long argument lists.** Java passes `(Game, Card, SpellAbility, Player, ...)` everywhere. Refactoring into context structs would diverge from the reference. `clippy::too_many_arguments` is silenced crate-wide.
- **Verbose conditionals.** Java's `if/else` chains often have logically distinct branches that reach the same outcome. Mirroring beats collapsing. `clippy::if_same_then_else` is silenced.
- **Deeply nested generics.** `clippy::type_complexity` is silenced for the same reason.

These trade-offs are intentional. Don't "clean them up."

## When parity is not required

- **Pure performance.** Caching, memoization, arena layout — fine to diverge if behavior is identical.
- **Pure rendering / UI.** The UI is a fresh design, not a port of Forge's Swing surface.
- **Build / tooling.** Cargo workspace shape, scripts, CI.

Everything that can show up in a parity trace must mirror Java.

## When you're stuck

If the Java reference does something you don't understand, do not invent a Rust-side workaround. Either:

1. Ask the developer to clarify what Forge is doing, or
2. Leave a `// TODO(parity): ...` and surface it in the PR.

Inventing logic that "looks reasonable" is the fastest way to introduce divergence that survives until someone runs the right matchup.
