# Roadmap

`manabrew` is pre-release software. This roadmap documents the public direction
without promising dates.

## Current Focus

- Keep the Java Forge backend path usable through the modern client/runtime
  stack.
- Bring the Rust engine into parity with Java Forge by fixing reproducible
  divergences at the mechanic level.
- Improve the web/WASM and Tauri development loops so contributors can run the
  client locally without project-specific setup knowledge.
- Make self-hosted room and relay flows clear enough for small groups to test.
- Keep licensing, attribution, and fan-project boundaries explicit.

## Engine Correctness

The Rust engine is judged against Java Forge. The immediate goal is not to
claim independent rules authority; it is to reproduce Forge behavior with the
same decks, seeds, deterministic choices, and first-divergence traces.

Near-term work:

- expand named parity scenarios for real deck archetypes;
- reduce first-divergence failures in existing regression decks;
- keep Forge card-script semantics documented as typed Rust IR grows;
- make parity results easier to summarize in issues and PRs.

## Client And Runtime

The client should make Forge-backed play available through modern surfaces while
the Rust engine matures.

Near-term work:

- keep Java Forge sessions usable through the existing prompt and game-view
  model;
- improve web/WASM build reliability;
- document self-hosted multiplayer setup;
- tighten deck import, lobby, and game-flow ergonomics;
- package preview builds when the release process is ready.

## Contributor Experience

The most useful early contributions are small, reproducible, and grounded in
the existing architecture.

Near-term work:

- keep issue templates specific enough to capture parity commands, deck names,
  seeds, and platform details;
- make the first engine-fix workflow obvious from the README;
- keep AGENTS.md and docs accurate as modules move;
- publish honest status notes when public behavior changes.

## Out Of Scope For Now

- A hosted commercial game service.
- Bundling card images or card art.
- Replacing Forge as the source of truth for behavior.
- Large rewrites that do not improve parity, runtime reliability, or
  contributor clarity.
