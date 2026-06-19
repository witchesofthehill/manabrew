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

- **common** — anything used by both engines: RNG (`CountingRandom`), logging (`DecisionLog`, `ParityLog`), snapshot base (`SnapshotExtractor`), GUI bootstrap (`HeadlessGuiBase`), deterministic ordering / id mapping / reset (`ParityOrder`, `ParityCardMap`, `ForgeEngineReset`), the shared decision/cost/play plumbing (`ActionSpace`, `ChoiceSpace`, `CombatChoiceSpace`, `AutoPay`, `HarnessCostPlumbing`, `HarnessPlayPlumbing`, `HarnessPlayHooks`), and the prompt acceptance-rule facade (`EngineHandler`). `EngineHandler` is the one entrypoint for Forge GUI/controller legality: per prompt it returns the legal choice set (so a caller only offers valid picks) and post-validates the submitted answer for whole-answer constraints a per-option set can't express (e.g. `CombatUtil.validateBlocks`). Heavy mechanics stay in `ActionSpace`/`ChoiceSpace`/`CombatChoiceSpace`; `EngineHandler` unifies them.
- **parity** — `DeterministicController`, `DeterministicLobbyPlayer`, `PresetDecks`.
- **host** — `ManaBrewEngineAdapter` (the in-process facade Rust j4rs talks to), `ManaBrewInteractiveSession`, `ManaBrewInteractiveController`, `ManaBrewInteractiveLobbyPlayer`, `InteractiveSnapshotExtractor`, `PriorityFastForward` (skips a priority window with no roundtrip when the player has a standing pass-until; mirrors `manabrew-engine` `priority.rs`).

### Host payability probes must stay silent

`ManaBrewInteractiveController` sets `probingPayability` while engine code runs feasibility tests (`ActionSpace.getPossibleActions` → `ComputerUtilMana.canPayManaCost`, and the `ComputerUtilCost.canPayCost` pre-checks). These test paths call regular `PlayerController` choosers (`chooseCardsForConvokeOrImprovise`, `chooseCardsToDelve`, `choosePermanentsToSacrifice` via offering/emerge, `choosePlayerToAssistPayment`) — in native Forge only the AI ever hits them. Any chooser reachable from `CostAdjustment`/`ComputerUtilMana` must check the flag and answer silently (maximally permissive) instead of round-tripping to the UI. The real prompt happens once, in `payManaCost`, via `CostAdjustment.adjust(..., test=false, ...)` mirroring `HumanPlay.payManaCost` (taps convoked creatures, collects delve cards; `handleOfferingConvokeAndDelve` mirrors the HumanPlay helper). `DeterministicController` mirrors the same `probingPayability` flag around `ActionSpace.getPossibleActions` so its `chooseCardsForConvokeOrImprovise` returns the optimistic greedy estimate during action-space probing and declines (empty) during real payment.

### Convoke / Improvise in payment

`chooseCardsForConvokeOrImprovise` declines the upfront cost reduction outside payability probes (both controllers). Convoke/improvise is then resolved at payment time: interactively in `ManaBrewInteractiveController.payManaInteractively` (`payConvoke`/`convokePaymentSources`), and automatically in `AutoPay.payConvokeImprovise` for the auto-pay path (the host's auto button and the parity runner both route through `AutoPay`). Both tap the chosen creatures/artifacts, record `sa.addTappedForConvoke`, fire the `TapAll` trigger, and reduce the cost via `ManaCostBeingPaid.payManaViaConvoke`. **Parity caveat:** the Rust engine's auto-pay does not yet tap convoke/improvise sources, so `yarn parity` diverges on convoke/improvise spells until `manabrew-engine`'s auto-pay is mirrored.

### Delve in payment

Delve follows the same shape on the interactive (host) side only. `chooseCardsToDelve` declines the upfront reduction outside payability probes (returns `CardCollection.EMPTY`); the cost stays full into `payManaInteractively`, which exposes the activator's graveyard via `delvePaymentSources` (gated on the host's `DELVE` keyword and remaining generic). Picking a card (`delve` action → `payDelve`) defers it into the same `cardsToDelve` collection `CostAdjustment` would have filled — `decreaseGenericMana(1)` per card, no mid-session exile — and `undelve` reverses it (`increaseGenericMana`). The actual exile happens once, at the end, in `handleOfferingConvokeAndDelve`; cancel rolls back via the mana-payment snapshot, so there is no per-card un-exile. The host auto button greedily fills remaining generic from the graveyard (`autoDelve`) before `AutoPay.payManaCost`. The session emits a first-class `delveSourceIds` list in the `pay_mana_cost` prompt (distinct from `tappableLandIds`, since delve cards live in the graveyard, not the battlefield); the Rust bridge mirrors it through `JavaRawPromptBody::PayManaCost.delve_source_ids` → `PayManaCostInput.delve_source_ids`, and the `delve`/`undelve` UI actions through `ManaSourceAction::{Delve,Undelve}` → `JavaAction::{Delve,Undelve}`. `DeterministicController` (parity) is unchanged — it still resolves delve upfront via `CostAdjustment`. The Rust engine backend does not yet offer in-payment delve (its `pay_mana_cost` sends an empty `delve_source_ids`), so this is host-only.

## Boundary API discipline

`common` types are `public` only where genuinely consumed across a package boundary. `HarnessCostPlumbing` / `HarnessPlayPlumbing` / `AutoPay` expose **only** the constructor + methods the two controllers call (`payWithControllerDecision`, `isSpellPaymentContext`, `currentReservedSacrifices`, `playNoStack`, `handlePlayingSpellAbility`, `prepareSingleSa`, `orderAndPlaySimultaneousSa`, `playSaFromPlayEffect`, `payManaCost(WithTrace)`, `manaSources`, `floatManaFromSource`, `PayManaCostResult.paid/steps`); everything else stays package-private. When adding a member, keep it package-private unless a controller in `parity`/`host` needs it — don't widen the surface by default.

## External references (keep in sync)

- `forge.harness.Main` is the jar `mainClass` (pom) and is invoked by parity and self-hosted-node (CLI flags). Keep `Main` in the root package.
- `forge.harness.host.ManaBrewEngineAdapter` is loaded by class name in `src-tauri/src/engine_backend/java_backend.rs` (`create_instance`). Moving/renaming it means updating that string.

## Build / verify

Jar is produced by `node scripts/harness.mjs ensure` (or `mvn -pl forge-harness package` from `forge/`). For a fast compile-only check against an existing fat jar:

```
javac -d /tmp/out -cp target/forge-harness-jar-with-dependencies.jar $(find src/main/java -name '*.java')
```

**After a `forge` submodule bump, do a _clean_ rebuild** (`mvn -pl forge-harness -am clean package -DskipTests`). `ensure`/`package` are incremental and key off source mtime, not the classpath — so a Forge change recompiles `forge/` but reuses the harness `.class` files compiled against the **old** Forge, silently shipping a broken jar (missing newer card enums like `CardSplitType.Prepare`, or synthetic `switch`-map classes like `SnapshotExtractor$1` → deck-load failures or a runtime `NoClassDefFoundError`). A Forge API change may also require updating the `PlayerController` overrides in `host/ManaBrewInteractiveController` + `parity/DeterministicController` (and call sites in `common/HarnessPlayPlumbing`) before it compiles. Keep the submodule pinned to the recorded gitlink with `git submodule update --init forge`; only `--remote` advances it. Build with JDK 18–21 — newer JDKs (e.g. 26) fail to compile Forge.
