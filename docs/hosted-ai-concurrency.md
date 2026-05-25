# Hosted "Play vs AI" — concurrency model

The hosted node runs Java Forge so the web client can play vs AI without the
Rust engine. The problem: Forge keeps process-global statics (`MyRandom`, the
`maxId` counters), so two games in one JVM clobber each other — it can't host
concurrent games.

## Espresso, one context per game

The node embeds **GraalVM Espresso** (Java-on-Truffle). Each game gets its own
guest `Context`, which has its own copy of the statics, so games are isolated.
`ManaBrewEspressoAdapter` is the host-side router: it maps `sessionId → Context`,
mirroring `forge.harness.ManaBrewEngineAdapter`'s JSON string API.

- **One context = one game's blast radius.** Default is single-use: a context
  serves one game, then closes. In-place reuse is opt-in via
  `-Dmanabrew.espresso.reuse=true` (safe only because `close()` now joins the
  game thread).
- **Pre-warm pool.** `FModel.initialize` costs ~50 s. A background replenisher
  keeps `manabrew.espresso.poolSize` warm contexts ready so a player joining
  doesn't pay that on the hot path. Falling through to an on-demand build logs a
  pool-exhaustion warning.

## Constraints

- **Host JVM must be GraalVM** (the Espresso polyglot runtime). It won't load on
  HotSpot/temurin.
- **Never uber-jar the guest.** Ship a thin host jar + `target/lib/` of deps;
  fat-jarring breaks Espresso's Multi-Release / internal-resource loading. The
  guest classpath is passed via `-Dmanabrew.guest.classpath`.
- **macOS:** native Espresso embedding is broken (libjava/libjvm split-cache
  rpath). It runs fine in a **Linux container** — so test via Docker, not a
  native macOS build.

## Capacity

Each live context is ~**260 MB** (the card DB; can't be shared without losing
isolation). **RAM is the wall, not CPU** — 2 cores handle many human-paced games.
So an N-concurrent-game node needs roughly `N × 260 MB` plus the ~1.25 GB node
JVM. A 3 GB box does ~3 contexts at most; real concurrency wants a bigger box or
multiple nodes with the relay routing by advertised capacity.

The 3 GB staging box can't be used to preview this: building the image in place
(rust release + maven + GraalVM) plus running one espresso JVM exhausts its RAM.
Java-engine E2E belongs on a fat CI runner (the `hosted-smoke` harness) or local
Docker, not the staging preview.
