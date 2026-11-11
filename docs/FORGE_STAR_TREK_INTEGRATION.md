# Forge Star Trek integration

## Update scope

The Forge gitlink previously pointed at `be9e0c8a5b561ae3e909c2f9a8bdac0a7fa2b097`.
This update merges canonical upstream `7556e53cb1583e82eba2839d0e45f9b8ec8ac075`
into the Manabrew fork, preserving its replay, synchronous execution, thread-local
RNG, AI deadline and static-ability cache changes. Do not replace the fork with
canonical upstream directly. The fork has 63 commits absent from upstream.

The upstream merge includes the Star Trek release merge `7db198d72e0` and other
changes since the previous pin. It is not a card-data-only update.

The fork merge is published as
[Forge PR #21](https://github.com/witchesofthehill/forge/pull/21), commit
`62aec217f31`.

Forge defines `TRK` and `TRC` with a release date of November 13, 2026. An inventory
of the editions' `[cards]` sections matched all 648 distinct names to card scripts.
These counts include reprints and basic lands, not just newly designed cards.

| Edition                  | Distinct names | Station scripts | Beam me up scripts | Assimilate scripts |
| ------------------------ | -------------: | --------------: | -----------------: | -----------------: |
| Star Trek, TRK           |            311 |              17 |                 10 |                  2 |
| Star Trek Commander, TRC |            337 |              18 |                  0 |                  6 |

The counts describe source coverage, not verified Manabrew gameplay support.

## Changes accompanying the pin

- Implement the three new abstract sticker callbacks in the interactive controller
  with existing typed selection/card prompts. Choices include ticket prices,
  optional decline, name-word insertion positions and the card that keeps stickers
  after merged cards separate. The legacy controller receives implementations only
  so the shared harness compiles; do not run parity to validate this update.
- Retain the session's installed RNG for journal verification. Upstream now wraps
  `MyRandom.getRandom()` for draw accounting, so casting its result to `ReplayRandom`
  is no longer valid. Cross-version replay remains unsupported, as documented in
  [Decision journal and rewind](DECISION_REPLAY.md).
- Capture Forge's waiting-trigger count before casting and pass it to the expanded
  `rollbackAbility` API. Cancellation must clear only triggers from the abandoned
  cast, not triggers that were already waiting.
- Supply the new headless `IGuiBase.getUserAgent` method with a Manabrew identifier
  and project URL for Forge's HTTP requests.

This PR updates Forge and plans the remaining bridge work. It does not claim full
Star Trek support. Beam me up is a release blocker until the integration below lands.

## Required bridge work

### 1. Beam me up alternative costs

This is a confirmed runtime gap, already possible at the previous pin. The larger
TRK card pool makes it more visible. Forge's
`forge-game/src/main/java/forge/game/GameActionUtil.java` constructs an
`AlternativeCost.BeamMeUp` graveyard cast and adds
`Return<1/Creature.YouCtrl+canBeBeamedUp/creature>` as an additional cost.
`CardFactoryUtil` installs the exile replacement for the resulting spell.

`ManaBrewInteractiveSession.alternativeCostKind` has no `BeamMeUp` case and throws
for that action. `AlternativeCostKind` in
`manabrew-rs/crates/manabrew-protocol/src/prompts/common.rs` has no corresponding
wire variant either. Do not relabel it as flashback or silently omit the action.

Implementation order:

1. Add a typed `BeamMeUp` alternative-cost variant to the protocol. Inspect every
   exhaustive consumer and both action producers before changing the enum. Keep
   the existing `PlayCardMode::Alternative` representation.
2. Map Forge's value in `ManaBrewInteractiveSession.alternativeCostKind`, supply the
   human-readable "Beam me up" label, and include the mode in deterministic action
   ordering in `forge.harness.common.ParityOrder`. This ordering also serves live
   journal reconstruction, despite the class name.
3. Regenerate protocol bindings, generated Java classes and protocol documentation
   in sequence with `yarn gen:types`, `yarn build:harness`, and
   `yarn gen:protocol-docs`. Review the protocol version/release compatibility
   requirements for a new wire enum value.
4. Reuse the existing return-card cost chooser and human cost-payment rollback.
   Verify its interaction with mana prediction and cancellation rather than adding
   a second payment mechanism.

Acceptance cases for Open Communications and Energize:

- Offer the graveyard cast only when the full additional cost can be paid. Include
  Forge's `canBeBeamedUp` restrictions, not merely creature ownership.
- Let the player choose the returned creature, including a token or a creature
  controlled but not owned by that player. Resolve the owner-hand destination.
- Cancelling mana payment restores the returned creature, prior taps and paid mana.
- Successful casting produces the correct spell on the stack. Resolution and
  countering both exile it instead of leaving it in the graveyard.
- Journal replay reproduces the cast choice, return choice and continued play.

### 2. Station and Spacecraft

No new controller callback is required by the inspected source. `CardFactoryUtil`
expands Station into a sorcery-speed `PutCounter` activation with
`tapXType<1/Creature.Other>` and `TappedCards$TapPowerValue`. Existing cost plumbing
already routes tap-card choices. `InteractiveSnapshotExtractor` projects live types,
subtypes, keywords, power/toughness and charge counters.

Validate those existing paths before adding protocol fields:

- U.S.S. Enterprise-D stations another creature and receives counters equal to its
  effective power. Check summoning-sick creatures, an already-tapped creature,
  cancellation and sorcery-speed legality.
- D-7 Battle Cruiser applies its 3-counter ability threshold independently of its
  8-counter creature threshold. U.S.S. Prometheus likewise has multiple thresholds.
- Deep Space 9 and Transwarp Hub gain threshold abilities without becoming creatures.
  Never infer creature status from Station or a single threshold number.
- Sulu, Heroic Helmsman uses tripled power when stationing. Counter loss updates
  live characteristics and legal actions.

Dedicated threshold visuals are optional presentation work. If added, project
Forge's actual active state rather than parsing printed rules in the client.

### 3. Assimilate

Forge's `AssimilateEffect` owns control changes, zone movement, the Borg artifact
creature type changes and the +1/+1 counter. Existing card snapshots carry the
resulting controller, types, subtypes, counters and current characteristics. No
Assimilate-specific wire command is justified by the inspected source.

Validate The Best of Both Worlds on a battlefield permanent, Borg Queen,
Perfection Manifest on a graveyard card, and The Borg Queen on an exiled library
card. Check entry triggers see the new types, ownership is preserved, prior
creature subtypes disappear, and the Saga's later exile/return clears the lasting
modification as Forge specifies. Include another viewer and journal rewind so a
correct local board does not hide a stale remote snapshot.

### 4. Existing mechanics and data delivery

Mission-named cards are ordinary enchantments in these scripts, not a new zone or
card type. For example, Exploratory Mission uses landfall, quest counters and a
normal exile-play permission. New Planet is a `Land Planet` token with an existing
any-color mana ability. Validate these through the existing token, counter,
exile-play and hidden-information paths. Do not introduce a "Mission" protocol.

Warp is not a new TRK mechanic. The bridge already maps its alternative cost and
projects `isWarpExiled`. Names such as Warp Core do not imply the Warp keyword.

Refresh all runtime artifacts from the same pin before testing or shipping:

- Clean-build the JVM harness with JDK 18–21. Incremental Maven builds can retain
  harness classes compiled against the previous Forge API.
- Rebuild the Rust card archive/browser WASM with `yarn ensure:wasm`, including TRK,
  TRC, their token scripts, editions, formats, draft rankings and type-list data.
- Rebuild the browser Java engine with `yarn build:forge-wasm` and the native Forge
  library through its existing build workflow. A new harness jar alone does not
  update the browser Web Image or the native shared library.
- Refresh the shipped token metadata with the existing token-archive workflow if
  the new Forge token scripts are not represented. Check Scryfall printing and
  image availability separately from engine script availability.

## Other changes included by the upstream merge

Upstream adds `CardSplitType.Vengeance` outside the Trek sets. The Rust
`forge-foundation/src/card_split.rs` does not recognize it, and
`forge-carddb/src/parser.rs` leaves unrecognized `AlternateMode` values at `None`.
Plan the foundation/parser/card-face consumer update before claiming support for
those cards. Existing Java snapshot face indexes include `Secondary`, but that
does not repair a wrongly classified Rust catalog entry. The older `Prepare`
classification gap should be assessed in the same catalog work, not hidden by this
submodule update.

The sticker callbacks above restore build compatibility and interactive choice
routing, not complete sticker deck registration or sticker-specific visuals.
Audit those paths separately before advertising sticker support. Prismatic and
new counter kinds also arrive in this merge but are not new Trek bridge protocols.

## Verification and release gate

Run the clean Java build, the existing interactive-controller checks and the
journal rewind regression. Use headless scenarios for the acceptance cases above
when implementing their bridge changes. Do not run the deprecated parity system.
The developer performs visual UI verification.

The clean JDK 21 build, `ManaBrewInteractiveControllerTest`,
`HarnessPlayPlumbingTest` and `JournalRewindTest` passed. Rewind matched 141 prompts
and 423 views after reconstruction. A temporary headless check also exercised
mandatory/optional sticker choices, ticket labels, name insertion and keeper
selection, and instantiated five representative TRK/TRC cards.

Keep this update draft until the Beam me up bridge and focused Station/Assimilate
scenarios are complete. Full-set support also requires rebuilt browser/native/
card-data artifacts. Those artifact builds and visual UI verification were not
performed for this update.
