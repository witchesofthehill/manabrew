# Forge Parity and Compiled IR

This document explains how `manabrew` relates to Forge, what the parity harness
does, and how the Rust engine is starting to diverge internally through typed
compiled IR while preserving Forge behavior.

## Forge is the oracle

The Rust rules engine targets behavioral parity with Java Forge. The reference
source lives in:

```text
forge/forge-game/
```

The Rust port lives primarily in:

```text
manabrew-rs/crates/manabrew-engine/
```

When a mechanic is missing or wrong, the expected workflow is to read the Java
owner of that mechanic, then mirror the missing rule in the matching Rust
module. The parity harness verifies the result by running both engines with the
same deck pair, seed, and deterministic choices.

## Java Forge backend interoperability

`manabrew` also supports interoperability with the Java Forge engine itself. The
modern client, prompt protocol, and room/runtime stack are not only for the Rust
port: they can drive a Java Forge-backed session through the project harness and
backend adapters.

That gives the project two complementary paths:

- **Rust parity path:** use Java Forge as the oracle while porting mechanics to
  Rust and validating them with side-by-side traces.
- **Java backend path:** run actual Forge gameplay through the modern
  Tauri/web/self-hosted-room stack while the Rust engine remains incomplete.

The Java backend can be used behind a Tauri desktop bundle for local play or
through a self-hosted room/server deployment. Packaging details may change as
release work continues, but the architectural goal is explicit: players should
be able to use the modern stack without waiting for the Rust port to reach full
parity.

## What the parity harness compares

`parity` runs a Rust game and a Java Forge game side by side. It compares
state snapshots and reports the first field-level divergence: phase, turn,
player, object, and differing values.

Common commands:

```bash
yarn build:harness
yarn parity:test -- --deck1 red_burn --deck2 green_stompy --seed 42 --max-turns 20
yarn parity:test -- --matrix --seeds 42,100,999
```

The harness is not only a test runner. It is the core development tool for the
engine. It tells us where Rust behavior stops matching Forge, then the fix
should restore the underlying rule.

## Interpreted Forge scripts

Forge card scripts are text records such as:

```text
SP$ DealDamage | ValidTgts$ Any | NumDmg$ 3
SVar:DBGainLife:DB$ GainLife | LifeAmount$ 3
```

Forge's Java engine largely interprets these strings at runtime. The Rust port
started by preserving that compatibility model: parse Forge's files, keep the
same concepts, and resolve behavior through the same script vocabulary.

## Why compiled IR exists

Raw string interpretation is hard to audit at Rust scale. Many bugs hide in
places where a value is "just a string" but actually has semantics: a defined
object reference, a selector, produced mana, a numeric expression, a cost part,
or a sub-ability pointer.

Compiled IR gives those domains names and types. It helps:

- catch impossible combinations earlier;
- reduce repeated parsing in hot paths;
- make coverage visible through inventories;
- give contributors a typed place for new semantics instead of adding ad hoc
  string parsing;
- keep parity bugs localized to the same mechanic each time.

This is an implementation divergence from Java Forge, but it must not become a
behavior divergence.

## Current IR and SVar status

The current direction is:

- keep raw Forge script data as the compatibility source;
- parse common ability records into `SpellAbilityIr`;
- compile trigger, replacement, and static params into typed IR at
  construction (`TriggerIr`, `ReplacementEffectIr`, `StaticAbilityIr`);
- keep a lazy parsed-SVar cache on card state;
- lower numeric SVar expression families where they are used;
- type selected `DefinedRef` forms;
- type produced mana domains such as `Produced$` and `Combo ColorIdentity`;
- keep raw/unsupported buckets explicit for remaining DSL areas.

SVars are the most important constraint. SVar resolution is late-bound: the
engine resolves the named SVar from the current host-card state at the moment it
is needed. That means compiled IR must be lazy or cache-aware. Eagerly expanding
the whole SVar graph at card load time is wrong because transforms, copies, LKI,
and runtime SVar mutation can change what a later lookup should see.

See [forge-dsl-semantics.md](./forge-dsl-semantics.md) for the full SVar model.

## What remains raw on purpose

Full removal of strings is not the target. Some data is legitimately raw at a
boundary:

- UI and reminder text;
- diagnostics and inventory output;
- AI hints and card-script metadata;
- runtime event payloads;
- compatibility fallbacks such as `Raw(String)` or `Unsupported(String)`;
- rare card-script shapes not yet worth typing.

The practical goal is no surprise semantically meaningful raw strings in engine
logic. Raw domains should be named, inventoried, and intentional.

## High-value next IR areas

The next useful slices are narrow and family-based:

- more dynamic `DefinedRef` forms;
- selector and valid-filter atoms;
- cost-part DSL;
- amount and comparison expressions;
- effect-specific sub-IR for common high-traffic effects;
- `Defined$` and `Produced$` resolution that still round-trips typed IR
  through the legacy string matchers (`as_legacy_str`, `as_script_text`).

Each slice should keep a raw fallback until parity is stable.

## How contributors should use this

For ordinary parity fixes, do not start by designing new IR. First find the
missing Java rule and port it. Add typed IR only when the existing code is
already parsing the same semantic string repeatedly, the domain is high-risk, or
there is an established typed path for that family.

For IR work, keep the PR focused on one DSL family. Include an inventory or
coverage signal showing what moved from raw to typed and what remains raw.
