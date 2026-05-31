# forge-harness — package boundaries

Java side of the cross-engine work. One CLI entry, three internal packages with one-directional dependencies.

```
forge.harness            Main            CLI launcher / dispatcher (one-shot, --server, --interactive-server)
forge.harness.common     generic harness shared by parity AND host
forge.harness.parity     deterministic full-game parity runner
forge.harness.host       interactive self-hosted-node engine surface
```

Dependency rule (do not violate): `parity → common`, `host → common`, `Main → {common, parity, host}`. **`common` never imports `parity` or `host`. `parity` and `host` never import each other.** If a `common` class reaches for a `parity`/`host` type, it is misfiled — move it, don't add the back-edge.

## What goes where

- **common** — anything used by both engines: RNG (`CountingRandom`), logging (`DecisionLog`, `ParityLog`), snapshot base (`SnapshotExtractor`), GUI bootstrap (`HeadlessGuiBase`), deterministic ordering / id mapping / reset (`ParityOrder`, `ParityCardMap`, `ForgeEngineReset`), and the shared decision/cost/play plumbing (`ActionSpace`, `ChoiceSpace`, `CombatChoiceSpace`, `AutoPay`, `HarnessCostPlumbing`, `HarnessPlayPlumbing`, `HarnessPlayHooks`).
- **parity** — `DeterministicController`, `DeterministicLobbyPlayer`, `GuiRepro`, `PresetDecks`.
- **host** — `ManaBrewEngineAdapter` (the in-process facade Rust j4rs talks to), `ManaBrewInteractiveSession`, `ManaBrewInteractiveController`, `ManaBrewInteractiveLobbyPlayer`, `InteractiveSnapshotExtractor`.

## Boundary API discipline

`common` types are `public` only where genuinely consumed across a package boundary. `HarnessCostPlumbing` / `HarnessPlayPlumbing` / `AutoPay` expose **only** the constructor + methods the two controllers call (`payWithControllerDecision`, `isSpellPaymentContext`, `currentReservedSacrifices`, `playNoStack`, `handlePlayingSpellAbility`, `prepareSingleSa`, `orderAndPlaySimultaneousSa`, `playSaFromPlayEffect`, `payManaCost(WithTrace)`, `manaSources`, `floatManaFromSource`, `PayManaCostResult.paid/steps`); everything else stays package-private. When adding a member, keep it package-private unless a controller in `parity`/`host` needs it — don't widen the surface by default.

## External references (keep in sync)

- `forge.harness.Main` is the jar `mainClass` (pom) and is invoked by forge-parity and self-hosted-node (CLI flags). Keep `Main` in the root package.
- `forge.harness.host.ManaBrewEngineAdapter` is loaded by class name in `src-tauri/src/engine_backend/java_backend.rs` (`create_instance`). Moving/renaming it means updating that string.

## Build / verify

Jar is produced by `node scripts/harness.mjs ensure` (or `mvn -pl forge-harness package` from `forge/`). For a fast compile-only check against an existing fat jar:

```
javac -d /tmp/out -cp target/forge-harness-jar-with-dependencies.jar $(find src/main/java -name '*.java')
```
