# Hosted "Play vs AI" — concurrency design

Status: design notes / not yet built. Captures how the hosted Java engine could
serve multiple players, the blocker, how parity already works around it, and the
options (including a GraalVM/Espresso analysis).

## Goal

Let the self-hosted node serve **player-vs-AI** for more than one game — first
back-to-back (one node, repeated games), eventually multiple **concurrent**
users — using the **Java** Forge engine behind the j4rs facade.

## Current state

- **Rust node** is single-room: one `SharedEngineSession`, one `SharedBotState`,
  one `room_id`, one `run_client_loop` (`self-hosted-node/src/main.rs`). It hosts
  exactly one game per process startup ("no self-hosted room available" on the
  2nd game). This is just a bottleneck, fixable with a room manager / re-host.
- **Java adapter** (`forge-harness/.../ManaBrewEngineAdapter.java`) is already
  multi-session _in structure_: `sessions` is a `ConcurrentHashMap<sessionId, …>`,
  `start_game` adds a session, `getSession(id)` looks one up. One JVM can hold N
  session objects.

## The blocker: Forge's process-global mutable statics

"Multi-session" ≠ "safe concurrent play" on the Java engine, because Forge keeps
mutable state in **process-global statics**:

- `forge.util.MyRandom.setRandom(...)` — a **global** RNG, set per `startGame`.
  Two concurrent games share one global RNG; a second `startGame` clobbers the
  first's RNG → cross-game interference + broken determinism.
- Static **ID counters** (`SpellAbility.maxId`, `Trigger.maxId`, `Game.maxId`,
  `StaticAbility.maxId`, …) — global; `ParityReset.resetAllIdCounters()` zeroes
  them per `startGame`, which corrupts the IDs a concurrently-running game relies
  on.

The **Rust engine is the opposite** — `run_hosted_multiplayer_game` takes a
per-game `rng` + `GameState`, no globals — so the rust backend _can_ run
concurrent games in-process. The constraint is specific to the **Java** engine.

## How parity already handles it (the mechanism to borrow)

`forge-parity` (`java_bridge.rs`) has two modes:

- **`JavaBridge`** — one-shot subprocess per matchup (fresh JVM = full isolation,
  but pays ~2–3 s `FModel.initialize()` each time).
- **`JavaServer`** — _one_ long-lived JVM, reads JSONL requests on stdin, runs
  games **sequentially**, reusing `FModel`. Between games it scrubs the globals:
  `ParityReset.resetAllIdCounters()` (reflective static reset, no forge-game
  changes) + `MyRandom.setRandom(new CountingRandom(seed))`.

So parity's "novel" trick is **reflective reset of the process-globals between
games**, enabling one JVM to run many games **sequentially** without
process-per-game. Parallelism in parity comes from running **multiple server
processes**, never concurrent games in one JVM.

**The hosted node already does the reset**: `ManaBrewEngineAdapter.startGame`
calls `ParityReset.resetAllIdCounters()` + `MyRandom.setRandom(...)` on every
game (wired when we added seeding). So the j4rs path is already "parity server
mode" — one JVM, reset per game. It just doesn't re-host after game-over yet.

Key consequence: the reset works **between** games, not **during** — it cannot
isolate two games running at the same time. So it gives _sequential reuse_, not
concurrency.

## Two axes

1. **Sequential reuse (cheap, mostly done).** One node serves unlimited
   back-to-back games. Java side is already reset-per-`startGame`; only the
   **rust-side re-host** is missing (after game-over: tear down session+bot,
   re-host a fresh room, loop). No globals problem (one game at a time).
2. **True concurrency (the hard part).** Multiple simultaneous games. Blocked by
   the globals unless each game gets isolated static state.

## Concurrency options

| Approach                               | In-process?   | Isolates statics? | Speed                      | Effort / risk                                                                         |
| -------------------------------------- | ------------- | ----------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| In-process multi-room, single JVM      | ✅            | ❌                | full                       | blocked by Forge globals — broken                                                     |
| **Espresso context-per-game**          | ✅            | ✅ (clean)        | ~2–3× slower, experimental | host on GraalVM + adapter creates a Polyglot `Context` per game                       |
| Classloader-per-game                   | ✅            | ✅ (messy)        | full HotSpot               | reflective reset per loader, `FModel.initialize` per loader, classloader-leak hazards |
| Process-per-game                       | ✅            | ✅                | full                       | JVM startup + memory per game                                                         |
| **N node processes (sequential each)** | process-level | ✅                | full                       | trivial; concurrency = process count                                                  |

## GraalVM analysis (we dug into this)

### Espresso (Java on Truffle) — the genuinely relevant capability

Espresso is a full JVM implementation that runs **standard Java bytecode**
(Java 8/11/17/21) — **no AOT, no native-image, no reflection-config**. It can
embed **multiple isolated guest-JVM contexts in one process** via the Polyglot
API (docs' own example: a Java 8 context inside a Java 11 app). Each context is a
separate guest JVM → separate class loading → **separate static state**.

→ One Espresso context per game gives each game its **own `maxId` counters and
own `MyRandom`** → real in-process concurrent isolated Forge games, running
Forge's normal bytecode, no process-per-game, no AOT port. This dissolves the
global-statics blocker and is cleaner than hand-rolled classloader isolation.

**Catches:**

1. **Performance ~2–3× slower than HotSpot at peak, and officially experimental /
   not production-ready.** Workload-dependent: a card game does little compute per
   turn and human play is think-time-bound, so the hit is likely **invisible for a
   human-vs-AI game** — but it **hurts the bot-vs-bot soak** (wants fast sims). So
   keep the soak on HotSpot; only consider Espresso for the live hosting path.
2. **Multi-context is mutually exclusive with native-image speedup** —
   native-executable Espresso is limited to **one context**; multi-context only
   works running Espresso _on a JVM_ (normal startup + 2–3× exec + isolation).
3. **Native-library static conflicts** across contexts (mitigated via `dlmopen` on
   Linux). Forge is essentially pure Java, so probably N/A — confirm in a spike.

**Integration sketch:** `JAVA_HOME` → GraalVM (with the Espresso component); the
node's j4rs still talks to the host GraalVM JVM; `ManaBrewEngineAdapter` creates
one Polyglot `Context` per session and runs Forge inside it (one context per
thread).

### GraalVM Native Image / isolates — why not (now)

- **Native Image** would cut process-per-game startup/memory, but (a) doesn't fix
  in-process concurrency by itself, and (b) compiling **Forge** (heavy reflection +
  32k dynamically-loaded card scripts) under closed-world AOT is a major, uncertain
  effort — likely the wrong place to spend.
- **Isolates** (per-isolate heap → per-isolate runtime statics) is the
  theoretically-relevant feature, but it's native-image-only (so gated on the hard
  AOT port), low-level (`CEntryPoint`), and doesn't fit the j4rs/JNI model.

## Infra constraint (2026-05-22)

The team **pushed back on spawning node processes unbounded in infra** — so the
"N node processes" parallelism model (option #2 below, parity's own approach) is
**off the table for production**. That removes the cheap concurrency escape hatch
and makes **in-process isolation the concurrency path**, i.e. Espresso
context-per-game is now the primary concurrency bet, not a medium-term maybe.

(Sequential re-host within one process is unaffected and still worth doing first —
it's orthogonal to concurrency.)

## Recommendation (staged)

1. **Sequential re-host** (rust node): after game-over → reset session/bot →
   re-host a fresh room → loop. Java side already scrubs globals per `startGame`
   (parity server mode), so one node serves unlimited back-to-back games.
   Lightweight, rust-only. **Concrete near-term PR**, independent of concurrency.
2. ~~Concurrency for the alpha = run N node processes~~ — **ruled out**: infra
   won't allow unbounded process spawning. Kept here only as the rejected baseline.
3. **Concurrency = Espresso context-per-game (the bet).** Host Forge in N Espresso
   contexts, one per session; each context has its own statics → real in-process
   concurrent isolated Forge games. **Spike this** (plan below) before committing.
   Keep the bot-vs-bot soak on HotSpot (Espresso's 2–3× hit only matters for sims);
   hosting goes on Espresso.
4. In-process single-JVM multi-room and the Native-Image/isolates route are **not**
   worth pursuing for this.

## Integration model (the clean one): string boundary, guest-side adapter

The adapter's whole API is **already JSON string in / JSON string out**
(`startGameJson`, `submitAction`, `getPrompt`, `getSnapshot`, `getGameOver`,
`endGameJson` — see `ManaBrewEngineAdapter.java`). Strings are the one thing that
marshals across the polyglot boundary with zero ceremony. So we do **not** rewrite
the adapter against polyglot `Value` handles. Instead:

- **Host JVM** (what j4rs loads) becomes a thin **router**: holds
  `Map<sessionId, Context>`, creates one Espresso `Context` per session, and for
  each call evals/invokes a **guest-side `ManaBrewEngineAdapter`** inside that
  context, passing the JSON string in and returning the JSON string out.
- **Guest context** = isolated guest JVM with Forge + the existing adapter on its
  classpath → its **own `Game.maxId` / `MyRandom` / FModel**. The adapter code runs
  unchanged inside the guest; it just no longer shares statics with its neighbours.
- j4rs ↔ host stays exactly as today (string methods). Only the host adapter's body
  changes (direct call → context dispatch). This is the smallest possible diff that
  buys per-session isolation.

Caveat to verify in the spike: each context needs `FModel.initialize` + the full
card DB load (memory/time per context); the host must keep one `Context` per live
session and close it on `endGame`.

## Spike plan (risk-ordered, kill-criteria first)

Throwaway, lives in `~/dev/espresso-spike/` (outside the repo — never commit a JDK).
Toolchain: GraalVM CE 25 tarball (no sudo, no system install); Espresso pulled as a
Maven polyglot dependency (modern GraalVM has **no `gu`** — Espresso ships as
`org.graalvm.polyglot:java-community` + `org.graalvm.polyglot:polyglot`).

- **S0 — toolchain.** GraalVM CE 25 host JVM; minimal Maven project; `Context
.create("java")` succeeds. _Kill if: can't even create a java context on this
  GraalVM build._
- **S1 — isolation (cheap, do before touching Forge).** Tiny class with a
  `static int counter`; load in 2 contexts, increment in each, assert independent.
  Proves the core premise. _Kill if: statics leak across contexts._
- **S2 — Forge in a context (the real risk).** Put Forge + the adapter on a guest
  context's `java.Classpath`; run `FModel.initialize` then a full game via the
  existing JSON entry points, to game-over. This is where reflection / resource
  loading / 32k card scripts inside Espresso may break. _Kill if: Forge can't init
  or run inside Espresso._
- **S3 — concurrency.** 2 contexts, each a Forge game, on 2 threads at once; assert
  no cross-talk (IDs monotonic per game, RNG independent). The actual goal.
- **S4 — cost.** Per-decision latency vs HotSpot for a real game; context memory
  footprint → contexts-per-host capacity estimate.

## Spike results (2026-05-22)

Ran S0/S1 with GraalVM CE 25.0.2 + Espresso pulled as Maven polyglot deps
(`org.graalvm.polyglot:polyglot` + `:java-community` + `org.graalvm.espresso:
espresso-runtime-resources-jdk21`). Throwaway project in `~/dev/espresso-spike/`.

- **S0 PASS (macOS arm64 + Linux):** two `Context.create("java")` contexts spin
  up fine. The multi-context polyglot machinery works.
- **S1 PASS (Linux container `maven:3.9-eclipse-temurin-21`):** a guest class with
  a `static int` counter, loaded into 2 contexts — incrementing in ctx1 (→2) left
  ctx2 independent (→1). **Java statics are isolated per context.** This is the
  whole premise: Forge's `Game.maxId`/`MyRandom` would be per-context, so N
  concurrent isolated Forge games in one process is real.
- **macOS arm64 embedding is broken** for the _guest VM bring-up_: `VM
.loadJavaLibrary` fails (`Cannot load library: java`/`eden`) across all native
  backends (`nfi-native`, `nfi-llvm`; `nfi-dlmopen` gets furthest). Cause: the
  resource jars extract `libjava`/`libjvm`/`libnespresso` into **separate
  content-addressed cache dirs**, and `libjava`'s only rpath is `@loader_path/.`,
  so it can't find the mokapot `libjvm`. Co-locating them didn't fix it. Treat
  **macOS as unsupported for embedding**; validate + ship on **Linux** (the prod
  node target, where `dlmopen` and the native packaging are first-class).
- **Gotchas confirmed:** (a) interpreter-only + `JVMCI not enabled` warning on a
  non-GraalVM host JVM — functionally fine, slow; use a GraalVM host for the perf
  numbers. (b) Guest bytecode must be **≤ guest JDK** (got `Unsupported major.minor
69.0` from a Java-25-compiled guest class on a JDK21 guest). Forge builds on Java
  18 (v62 ≤ v65 of JDK21) → loads fine as a JDK21 guest. (c) `gu` is gone in modern
  GraalVM; Espresso = Maven deps only.

Net: **premise validated on Linux; S2 (Forge inside a context) is the next risk.**

### S2 PASS (2026-05-22) — Forge runs a full game inside a context

Drove `forge.harness.Main.main` (the headless bot-vs-bot one-shot) **inside** an
Espresso context, Forge fat-jar on the guest `java.Classpath`, `forge-gui/res`
mounted, decks from `parity_decks/`. Result: `FModel.initialize` loaded the full
card DB, decks built, a real game played (Lightning Bolt → 20→17, AI decisions,
snapshots), reached `Game over. Winner: Player2`. **So Forge's reflection + 32k
card scripts + game loop all work under Espresso.** Integration hurdles cleared:
guest classpath, host `String[]`→guest arg marshalling (pass `(Object) args`,
auto-converts), filesystem/asset IO, guest `System.out`.

**Caveat — speed:** the guest run took **287 s** on a _temurin_ (non-GraalVM) host,
i.e. **interpreter-only** Espresso, almost entirely the one-time card-DB load. Since
context-per-game pays init **per context**, a **GraalVM host JDK (JIT) is
load-bearing, not optional**. Keep this number as the "interpreter floor."

### S2 speed: GraalVM JIT vs interpreter (2026-05-22)

Same guest workload (Forge full game, max-turns 2), only the **host JVM** changed:

| Host JVM           | Espresso runtime              | Guest run time          |
| ------------------ | ----------------------------- | ----------------------- |
| temurin 21 (stock) | interpreter-only (JVMCI off)  | **287 s**               |
| GraalVM CE 25      | Graal JIT (no interp warning) | **87 s** (~3.3× faster) |

87 s is still **almost entirely the one-time card-DB load** (32k scripts); steady-
state in-game decisions were fast in both. So per-_context creation_ is the cost,
not per-decision.

### The amortization model (resolves init cost) — pool of reset-reused contexts

The 87 s is a per-**context** cost, not a per-**game** cost — _if_ we reuse contexts.
Parity already proves the pattern: pay `FModel.initialize` once, run many games
sequentially in the warm JVM, scrub globals between them. Combine that with
context-per-game to get **both** axes at once:

- **N long-lived contexts** → N concurrent isolated games (concurrency).
- **Each context reused across many sequential games**, reset between with the
  node's existing `ParityReset.resetAllIdCounters()` + `MyRandom.setRandom()` →
  init paid **once per context at pool warm-up**, never per game (amortization =
  parity `JavaServer`, replicated N-wide).

So init time is a boot cost (N× at startup, parallelizable across cores), not a
hot-path cost. **The real ceiling is therefore memory, not time:** each context
holds its **own full card DB** (no shared statics — by design), so single-host
capacity ≈ usable heap ÷ per-context footprint. **Per-context memory footprint is
the number to measure next** (S4/capacity), ahead of any further speed work.

Open risk for reuse: confirm `ParityReset` + `MyRandom` fully scrub a context for
the next game (no other Forge static residue). The node already relies on this for
its per-`startGame` reset, so it should hold inside a context identically — verify
in the pool spike.

### S4 PASS (2026-05-22) — capacity + reset-reuse, both measured

Ran on the GraalVM CE 25 host. Two probes (`MemProbe`, `ReuseCtx`).

**Per-context memory footprint** (host heap, post-GC, each context fully
`FModel.initialize`d and kept live):

|          | used heap | incremental |
| -------- | --------- | ----------- |
| baseline | 1 MB      | —           |
| + ctx#1  | 274 MB    | **272 MB**  |
| + ctx#2  | 533 MB    | **259 MB**  |
| + ctx#3  | 792 MB    | **259 MB**  |

→ **~260 MB per fully-loaded Forge context.** Much cheaper than feared (not GB-
scale). So memory is _not_ a tight ceiling: a ~16 GB heap holds **~50 concurrent
contexts**, far past an alpha's needs. Single-host concurrency is viable.

**Init amortizes across contexts too:** ctx#1 took 90 s but ctx#2/#3 only ~50 s —
the host Graal JIT compiles Espresso's interpreter hot paths once and **shares**
that across all contexts, so a warm pool inits each new context faster. (Pool
warm-up is still ~50 s/context, parallelizable across cores.)

**Reset-reuse (the amortization model itself): PASS.** Drove `Main --server` in
**one** context: a single `FModel.initialize`, then two games via stdin.

- game 1 (seed 42): `[parity-reset] Resetting all forge-game ID counters` →
  `Game over` → `{"done":true,"error":null}`.
- game 2 (seed 7): fresh shuffle **and card IDs restarted low** (`Mountain@3`,
  `Shock@7`, not continuing from game 1's `@4`/`@6`) → counters genuinely reset,
  `MyRandom` reseeded, no static residue → clean `{"done":true,"error":null}`.
- `quit` → clean exit 0.

So one warm context serves many sequential games correctly. Combined with ~260 MB/
context, the **pool-of-reset-reused-contexts** model is validated end-to-end on
Linux: N contexts for concurrency, each reused across games for amortization.

### P0 PASS (2026-05-22) — guest threads + host access coexist per context

S2 used the synchronous `Main` one-shot, but the real node uses the **interactive
adapter, which spawns a Forge game thread** while the host calls `submitAction`/
`getPrompt` in — a multi-threaded context-access pattern S2 never exercised. Smoke
test: two contexts, each guest runs a background thread incrementing a counter while
the host polls it. Both advanced independently (ctx1 417→716, ctx2 299→596). So an
Espresso context tolerates guest-spawned threads + concurrent host access, per
context. The interactive adapter's game-thread + cross-thread action handoff is
plain Java multithreading on top of that → low risk. Greenlights the node prototype.

### Prototype plan (chosen: single-thread interleaved concurrency)

Productizing into the node. Scope decision: **interleaved single-thread** (multiple
live games coexist on the existing single-threaded j4rs model, advanced in turn,
each in its own context) — proves the isolation win without j4rs per-thread attach
or multi-threaded Truffle access (deferred). Phases:

- **P0** ✓ threading smoke (above).
- **P1** host router `ManaBrewEspressoAdapter` (own JDK21 module, polyglot+espresso,
  outside forge's zulu-18 reactor): same string API as `ManaBrewEngineAdapter`,
  holds `Map<sessionId, Context>`, one guest context per session.
- **P2** Rust `java-espresso` feature: `J4rsBridge` instantiates the router instead
  of the adapter, adds polyglot to host classpath, passes `-Dmanabrew.guest
.classpath=<harness jar>`. Existing `java-forge` path untouched.
- **P3** validate with the node's real self-play loop (reuses `SimpleAi` + action
  translation) in a Linux container; then two interleaved sessions, isolation
  asserted. macOS can't run it (embedding gap) — Docker/Linux only.

### Prototype results (2026-05-22) — P1/P2/P3 done

- **P1** `manabrew.espresso.ManaBrewEspressoAdapter` (new module
  `forge-engine/crates/self-hosted-node/java-espresso-host/`, JDK21, outside forge's
  reactor): mirrors the adapter's JSON string API, holds `Map<sessionId, Context>`,
  one guest context per session. Compiles + runs.
- **P2** Rust `java-espresso` feature (implies `java-forge`): `J4rsBridge::new`
  branches to instantiate the router, builds the host classpath, passes
  `-Dmanabrew.guest.classpath=<harness jar>`. `cargo check` clean for default /
  `java-forge` / `java-espresso`. Existing path untouched.
- **P3 PASS** (Linux container, GraalVM 25 host): router started session A, drove it
  to turn 1, **then started B while A was live** (B's `startGame` resets the global
  ID counters — corrupts A without isolation), interleaved both → **A turn 8, B turn
  7, no collision, no crash.** The exact scenario that breaks the single-adapter
  path today.

**Packaging lesson (important):** an **uber jar breaks Espresso.** maven-assembly
`jar-with-dependencies` dropped Truffle's `Multi-Release` manifest and corrupted the
espresso internal-resource bundles (first an `InternalError` on the MR check, then —
with the check disabled — a null `getInternalResource`). Fix: **thin jar + a `lib/`
of dependency jars on the classpath individually** (the layout the spike used). The
module's pom uses `dependency:copy-dependencies` into `target/lib/`; the Rust
`espresso_host_classpath` globs that dir. Never shade the polyglot/espresso jars.

- **P4 PASS** (Rust+GraalVM 25 Linux container): the node binary built `--features
java-espresso` ran its **real self-play loop** (SimpleAi + action translation)
  through **j4rs → `ManaBrewEspressoAdapter` → a guest context** to game over
  (`acted=527`, exit 0). Closes the full JNI→router→context path end-to-end, not just
  the Java router in isolation. Node crate build ~53s; one game ~42s on the GraalVM
  host.

All of P0–P4 are green. The prototype is end-to-end validated on Linux.

### Where the spike stands

S0/S1/S2/S4 all PASS on Linux. The concurrency bet is **technically de-risked**:
isolated statics ✓, Forge runs in-context ✓, ~260 MB/context ✓, reset-reuse ✓,
JIT amortizes across contexts ✓. Remaining work is **productization, not feasibility**:
wire a context-pool into the node's Java backend (host router → `Map<sessionId,
Context>` over the existing JSON string API), pick pool sizing, and the macOS-
embedding gap stays a desktop-only blocker (server is Linux). Throwaway spike code
in `~/dev/espresso-spike/` (`iso/`, `forgectx/`).

### Implication for bundling into the Tauri desktop app

If hosting stays **server-side** (self-hosted-node on Linux), Espresso works today.
But if we want play-vs-AI **embedded in the Tauri desktop app** (no server), then:
(1) the macOS native-loading breakage above becomes **blocking** (the desktop app
ships on macOS/Windows, not just Linux) and must be solved first; (2) bundle size —
a GraalVM JVM + Espresso runtime-resources + a guest JDK + Forge is **hundreds of
MB** added to the app. Server-side Linux hosting sidesteps both. Flagged as a
later problem; noting it because the macOS finding directly gates it.

## Production architecture (the final look)

The prototype (PR #54) proves the mechanism: router + one context per session,
single-thread interleaved, contexts created on demand. The production end-state
turns that into a pooled, lobby-integrated, self-healing service. Target shape:

```
web → relay → lobby ──assigns──> self-hosted-node (Linux, GraalVM host JVM via j4rs)
                                       │
                                  ManaBrewEspressoAdapter (router)
                                       │  holds a POOL of pre-warmed contexts
                       ┌───────────────┼───────────────┐
                  ctx#1 (game A)   ctx#2 (game B)   ctx#3 (idle, warm)
                  own statics      own statics      FModel pre-loaded
```

### Components / deltas from the prototype

1. **Context pool with pre-warm + background replenish.** Pay `FModel.initialize`
   (~50 s warm, ~90 s cold) at boot and on replenish — **never on the hot path**. A
   game start grabs a warm context; game-over resets it (`ParityReset
.resetAllIdCounters()` + `MyRandom.setRandom()`) and returns it to the pool. S4
   proved reset-reuse is clean (IDs restart, RNG reseeds, no residue).
2. **Lobby integration.** The node advertises `capacity = pool size`; the lobby
   assigns a player to a node with a free slot and the node runs the game in a
   pooled context. Replaces today's single-room bottleneck (`"no self-hosted room
available"` on game 2).
3. **Lifecycle / self-healing.** Idle-context eviction (reclaim memory under low
   load), and **per-context crash isolation**: a game that throws closes + replaces
   only its own context, not the node. One context = one blast radius.
4. **Concurrency model.** Two stages:
   - **Interleaved single-thread (alpha-sufficient).** Human play is
     think-time-bound — each game needs the JVM for only milliseconds per decision —
     so the router can round-robin many live contexts on one thread and it feels
     fully parallel to users. This is the prototype model, scaled by a poll loop. No
     j4rs-thread-attach work needed.
   - **True multi-thread (only when CPU-bound).** One worker thread per active game,
     each entering its own context, via j4rs per-thread JVM attach + multi-threaded
     Truffle context entry. Needed only when many AI computations fire simultaneously
     (bot-vs-bot, or many games mid-AI-turn at once). Deferred until measured need.

### Sizing

- **Memory-bound:** ~260 MB / fully-loaded context → ~50 contexts / 16 GB heap.
- **CPU-bound** only for simultaneously-_computing_ turns (Espresso ~2–3× HotSpot);
  human think-time means most live games are idle, so the pool can oversubscribe
  cores comfortably for human-vs-AI.
- Keep the **bot-vs-bot soak on HotSpot** (`java-forge`); Espresso (`java-espresso`)
  is the concurrent live-hosting path. The existing single-game `java-forge` path is
  untouched and remains the choice where concurrency isn't needed.

### Build / deploy

GraalVM JDK as the node's host JVM (Linux). The `java-espresso-host` module builds a
thin jar + `lib/` of polyglot/Espresso deps (never an uber jar). The node's Docker
image carries GraalVM + the harness jar (guest classpath) + the host jar/lib + the
cardset archive. CI builds the host module (maven, JDK21) alongside the harness jar.

## Open questions / spike plan

- Espresso spike: 2 contexts × Forge, assert `Game.maxId`/`MyRandom` are isolated
  per context; measure per-decision latency vs HotSpot for a real game.
- Capacity per host: JVM/context memory footprint with N concurrent Forge games.
- Lobby/relay role: how a user is assigned a node/room on demand (pool-replenish
  vs explicit create).

## Sources

- Espresso reference — https://www.graalvm.org/latest/reference-manual/espresso/
- Espresso implementation (native-exec single-context limit; native-lib isolation) — https://www.graalvm.org/latest/reference-manual/espresso/implementation/
- Java on Truffle (embedding multiple guest contexts; performance "not competitive yet") — https://www.graalvm.org/jdk20/reference-manual/java-on-truffle/
- Java on Truffle 22.2 (peak ~2–3× slower than HotSpot; experimental) — https://www.graalvm.org/22.2/reference-manual/java-on-truffle/
