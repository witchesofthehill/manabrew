# phase-ai `features/` subsystem — port characterization

Source: `phase-rs/phase` → `crates/phase-ai/src/features/` (~254 KB, 12 modules + `mod.rs`).
Target: manabrew `forge-engine/crates/forge-ai` (currently only `eval.rs`, `stats.rs`, `lib.rs` — no
profile/feature layer exists yet, so this is a **net-new subsystem**).

## 1. Directory inventory (from GitHub contents API)

| file | bytes | role |
|---|---|---|
| `aristocrats.rs` | 39,195 | sac-outlet / dies-trigger / fodder engine |
| `spellslinger_prowess.rs` | 31,461 | instant/sorcery density + prowess payoffs |
| `plus_one_counters.rs` | 29,982 | +1/+1 counter sources & payoffs |
| `tribal.rs` | 28,894 | creature-type concentration + lords |
| `tokens_wide.rs` | 28,673 | token generators + anthems / go-wide |
| `control.rs` | 28,424 | counters / removal / sweepers / draw |
| `aggro_pressure.rs` | 25,859 | low-curve aggressive pressure |
| `mana_ramp.rs` | 25,822 | dorks / rocks / fetch / rituals / extra land drops |
| `landfall.rs` | 14,861 | landfall triggers + **canonical fetchland disambiguator** |
| `mod.rs` | 4,976 | re-exports + `DeckFeatures` aggregate + `analyze()` |
| `tests/` | dir | shared test fixtures |

(Modules fetched & read in full: `aristocrats.rs`, `mana_ramp.rs`, `control.rs`; `mod.rs` read for the
aggregate.)

## 2. What a "feature" module is

Each module is a **per-deck, name-blind structural classifier**. Uniform shape:

- A `#[derive(Debug, Clone, Default)] pub struct XFeature { …counts…, commitment: f32, [extra ratios],
  [Vec<String> identity lists] }`.
- A `pub fn detect(deck: &[engine::game::DeckEntry]) -> XFeature` that iterates `DeckEntry { card:
  CardFace, count: u32 }`, walks each `CardFace`'s `abilities` / `triggers` / `static_abilities` typed
  AST, and classifies the face across a small set of **archetype axes** (e.g. aristocrats = outlet /
  death-trigger / fodder pillars; ramp = dork / land-fetch / ritual / extra-land-drop).
- Counts are accumulated by `entry.count` with `saturating_add`; each face contributes **at most once
  per axis** (bool sentinels).
- A **`commitment: f32` in `0.0..=1.0`** summarizing how central the archetype is to the deck.

Two distinct commitment styles appear and must be preserved:

- **Geometric-mean / synergy-gated** (aristocrats): `commitment = ((o·t·f)^(1/3) + free_bonus)` but
  **collapses to `free_bonus` (cap 0.2) if any pillar is 0** — enforces that a partial engine is not an
  archetype. Axis saturation points are hard-coded (outlets/3, triggers/3, fodder/5).
- **Weighted-sum, clamped** (mana_ramp: `0.12·dork + 0.10·fetch + 0.08·ritual + 0.20·extra_landdrop`,
  min 1.0; control: `clamp01(2·interaction_density + 1·draw_density)` with densities normalized by
  `total_nonland`, sweepers weighted 2×). Control additionally emits **`reactive_tempo`** (instant-only
  interaction density + instant ratio) and several instant-subset counts.

Extra structural details to carry over verbatim:

- **Identity `Vec<String>` lists** (aristocrats `outlet_names`, `death_trigger_names`): these exist because
  some policies (e.g. `AristocratsKeepablesMulligan`) run on **opening-hand objects whose abilities are
  not yet resolved**, so they fall back to name lookup; the activation-time policy re-classifies
  structurally and ignores the list. Any feature exposing names is doing this dual-handle pattern.
- **Cross-module delegation**: `landfall` is the *single owner* of fetchland shape detection
  (`ability_searches_library_for_land`); `aristocrats` imports it as a **negative filter** (a sac outlet
  must not be a fetchland), and `mana_ramp` uses the same notion to split fetch vs. ritual. `aristocrats`
  also shares `filter_references_creature_you_control_or_any` with `tokens_wide` (anthem scope).

### How features influence eval / decisions

The features layer does **not** itself score game states. It produces a static, per-game `DeckFeatures`
fingerprint that **policies/heuristics consume as weights**:

- `commitment` gates whether an archetype policy is "opted in" (e.g. ramp/aristocrats policies stay
  inert below threshold).
- counts and ratios bias specific decisions: sac-activation aggressiveness, mulligan keep/ship,
  removal sequencing, `reactive_tempo` for hold-up-mana play.
- It is computed **once per game from deck data**, not per node — cheap, deterministic, name-blind.

## 3. Relationship to `deck_profile` / `strategy_profile`

From `features/mod.rs`:

```rust
pub struct DeckFeatures {
    pub archetype: DeckArchetype,
    pub strategy: StrategyProfile,
    pub landfall, mana_ramp, tribal, control, aristocrats,
    pub aggro_pressure, tokens_wide, plus_one_counters, spellslinger_prowess: …Feature,
    pub bracket_tier: CommanderBracketTier,
}

pub fn analyze(deck: &[DeckEntry], tier: CommanderBracketTier) -> Self {
    let profile   = crate::deck_profile::DeckProfile::analyze(deck);
    let archetype = match &profile.classification {
        ArchetypeClassification::Pure(a)          => *a,
        ArchetypeClassification::Hybrid { primary, .. } => *primary,
    };
    let strategy  = crate::strategy_profile::StrategyProfile::for_profile(&profile);
    Self { archetype, strategy, landfall: landfall::detect(deck), …, bracket_tier: tier }
}
```

So the layering is:

1. **`deck_profile::DeckProfile::analyze(deck)`** — coarse classification (`Pure(arch)` /
   `Hybrid{primary,…}`) of `DeckArchetype`.
2. **`strategy_profile::StrategyProfile::for_profile(&profile)`** — derives a strategy posture from the
   profile.
3. **`features::analyze`** — the aggregator: takes the profile-derived `archetype` + `strategy`, then runs
   *all 9 per-archetype `detect()`s unconditionally* and bundles them with `bracket_tier`.

Implication for the port: `deck_profile` and `strategy_profile` are **upstream dependencies** of the
feature aggregate. The individual `detect()`s, however, depend **only** on `DeckEntry`/`CardFace` and are
independent of profile — they can be ported and tested in isolation before the aggregate is wired.

## 4. Engine / IR knowledge each module needs — and the manabrew gap

phase detects over **phase's own clean semantic AST**. Concretely the modules read:

- `engine::game::DeckEntry { card: CardFace, count: u32 }`.
- `CardFace.{abilities: Vec<AbilityDefinition>, triggers: Vec<TriggerDefinition>, static_abilities,
  card_type, name}`.
- `engine::types::ability::Effect` — a semantic enum: `Mana`, `Token{types,…}`, `ChangeZone{origin,
  destination,target,…}`, `SearchLibrary{filter,…}`, `Draw`, `Dig`, `Counter`, `Destroy`, `Bounce`,
  `DealDamage`, `DestroyAll`, `DamageAll`, `ChangeZoneAll`, `LoseLife`, `Scry`, …
- `AbilityCost` / `CostCategory` — `Sacrifice{target,count}`, `Mana{cost:ManaCost}`, `Tap`,
  `Composite{costs}`; category gate `CostCategory::SacrificesPermanent`, `TapsSelf`.
- `AbilityDefinition.{cost, cost_categories(), sub_ability}` + helper `collect_chain_effects()` that
  flattens an ability's effect chain (incl. `sub_ability`).
- `TriggerDefinition.{mode: TriggerMode, origin: Zone, destination: Zone, valid_card: TargetFilter,
  execute}` — e.g. dies = `ChangesZone` + origin `Battlefield` + dest `Graveyard`.
- `TargetFilter` tree (`Typed(TypedFilter{controller, type_filters})`, `Or`, `And`, `SelfRef`, `Any`),
  `TypeFilter::Creature/Land/AnyOf`, `ControllerRef::You/Opponent`.
- `StaticDefinition` / `StaticMode::{AdditionalLandDrop, MayPlayAdditionalLand}` (ramp).
- `CoreType::{Creature, Artifact, Instant, Sorcery, Land}`, `Zone::{Battlefield, Graveyard, Hand,
  Library, Exile}`.

**manabrew does NOT have this AST.** Findings from the target tree:

- `forge-carddb::CardFace` stores `abilities`, `static_abilities`, `triggers`, `replacements` as
  **`Vec<String>`** — raw Forge card-script DSL lines (e.g. `A:AB$ …`, `T:Mode$ ChangesZone …`,
  `S:Mode$ …`). There is no per-effect semantic enum on the card face.
- The semantic layer is the **Forge runtime IR** in `forge-engine/crates/forge-engine`:
  - `ability/api_type.rs` → `ApiType` enum (mirrors Java `ApiType`: `Mana`, `Token`, `ChangeZone`,
    `Pump`, `Counter`, `Draw`, `DealDamage`, `DestroyAll`, …).
  - `ability/ability_ir.rs` → `EffectIr`; `ability/effects/*` one resolver per effect.
  - `cost/*` → **one struct per cost part** (`cost_sacrifice.rs`, `cost_tap.rs`, `cost_add_mana.rs`,
    `cost_part_mana.rs`, …) rather than a single `AbilityCost` enum.
  - `trigger/*` → **one file per trigger type** (`trigger_changes_zone.rs`, `trigger_sacrificed.rs`,
    `trigger_destroyed.rs`, `trigger_taps_for_mana.rs`, …) + `trigger/trigger_ir.rs`,
    `trigger/trigger_type.rs`.
  - `staticability/*` for static modes.

So **the port's central, unavoidable design decision is: what does manabrew's `detect()` read over?**
Two options:

- **(A) Detect over the assembled Forge runtime IR** (`ApiType`/`EffectIr`, `Cost*`, `Trigger*`,
  static layers). Most faithful to phase's "structural over typed AST" philosophy, but requires a
  CardFace→assembled-ability bridge at deck-analysis time (forge assembles abilities lazily; see
  `card/card_assembly.rs`).
- **(B) Pattern-match the DSL strings** on `CardFace.{abilities,triggers,static_abilities}`. Cheaper,
  no assembly, but brittle and a semantic departure from phase (string matching is exactly what phase's
  doc comments say they *avoid*).

Recommended: **(A)**, reusing existing assembly so detection stays structural; fall back to (B) only for
features where the IR is not reachable pre-game.

### Per-module IR mapping cheatsheet (phase → forge)

- **landfall** (port FIRST — others depend on its fetchland helper): `SearchLibrary(Land)` +
  `ChangeZone→Battlefield` → `ApiType::ChangeZone` with library origin / search; landfall triggers →
  `trigger_land_played.rs`. Owns `ability_searches_library_for_land` — must expose the same helper.
- **mana_ramp**: dork = taps-for-mana permanent → `trigger_taps_for_mana.rs` / `cost_tap` +
  `ApiType::Mana` / `cost_add_mana`; ritual = non-permanent `Mana` effect that is not a land-fetch;
  extra land drop → `staticability` land-drop modes.
- **control**: `Counter`/`Destroy`/`Bounce(ChangeZone→Hand)`/`Exile(ChangeZone→Exile)`/`DealDamage`
  vs. their `*All` sweeper variants → `ApiType::{Counter, Destroy, ChangeZone, DealDamage, DestroyAll,
  DamageAll, ChangeZoneAll}`; draw → `ApiType::Draw`/`Dig`; needs `CoreType::Instant/Sorcery/Land` from
  `type_line`.
- **aristocrats**: sac outlet → `cost_sacrifice.rs` (gate = "sacrifices a creature you control",
  not fetchland, not pure-mana effect); dies trigger → `trigger_changes_zone.rs` (BF→GY, you/wildcard)
  or `trigger_destroyed`/`trigger_sacrificed`; fodder → `ApiType::Token` (types contain "Creature") or
  `ChangeZone` GY→BF of a creature.
- (tribal / tokens_wide / plus_one_counters / spellslinger_prowess / aggro_pressure not read in
  detail; expect analogous mappings to `type_line` subtypes, `ApiType::{Token,PutCounter,Pump}`,
  counter triggers, and curve/keyword inspection.)

## 5. Recommended port order

0. **Bridge layer (prerequisite):** decide A vs B above; if A, build a `CardFace → assembled
   abilities/triggers/statics` accessor usable at deck-analysis time, plus a thin
   phase-style helper surface (`collect_chain_effects` equivalent, `TargetFilter`/controller-scope
   readers over Forge's selector/`valid_card` params).
1. **`landfall.rs`** — smallest module (15 KB) and the **shared fetchland disambiguator** that
   aristocrats + ramp consume. Unblocks the rest; validates the bridge on the trickiest IR (search +
   change-zone).
2. **`mana_ramp.rs`** — simple weighted-sum commitment; exercises cost/mana/static IR; depends on the
   land-fetch notion from (1).
3. **`control.rs`** — no cross-module deps; exercises the full effect/sweeper taxonomy and ratio-based
   commitment + `reactive_tempo`.
4. **`aristocrats.rs`** — depends on landfall (negative filter) + shares helpers with tokens_wide;
   exercises cost gates, triggers, token/recursion effects, and the geometric-mean commitment.
5. **`tokens_wide.rs`** (shares helpers w/ aristocrats), then **`tribal.rs`**,
   **`plus_one_counters.rs`**, **`spellslinger_prowess.rs`**, **`aggro_pressure.rs`**.
6. **`deck_profile` + `strategy_profile`** (upstream of the aggregate) and finally **`mod.rs`
   `DeckFeatures::analyze` + `DeckArchetype` / `CommanderBracketTier`** to assemble the aggregate and
   wire it into `forge-ai` policies/eval.
7. Port each module's `#[cfg(test)]` fixtures alongside (aristocrats 22, mana_ramp 19, control 24 tests)
   — but rebuilt against forge IR fixtures, since phase's tests construct phase `AbilityDefinition`s.

## 6. Risks

- **IR impedance mismatch (highest).** phase's hand-designed semantic `Effect`/`AbilityCost`/
  `TriggerMode`/`TargetFilter` does not map 1:1 onto Forge's `ApiType` + per-part `Cost*`/`Trigger*`
  structs. Each gate (e.g. "sacrifice a creature you control AND not a fetchland AND non-mana effect")
  must be re-expressed against Forge selectors/`valid`/`ValidCard` predicate strings. Subtle
  mistranslations silently change counts and thus `commitment`.
- **Where to detect (assembled IR vs DSL strings).** Forge assembles abilities lazily and per-card;
  running detection pre-game may require triggering assembly or string-matching. Choosing B (strings)
  reintroduces exactly the name/text brittleness phase engineered away.
- **Controller-scope semantics.** phase rejects opponent-scoped filters and accepts wildcards
  ("a creature dies" includes yours). Forge encodes scope in `ValidCard`/`Defined` param strings
  (`Creature.YouCtrl`, `Creature`, `Creature.OppCtrl`); the You/Opponent/wildcard trichotomy must be
  faithfully decoded or aristocrats/control counts skew.
- **Fetchland disambiguation is load-bearing.** landfall's negative filter feeds aristocrats and ramp;
  if its forge mapping is imperfect, fetchlands leak in as sac outlets / rituals and corrupt three
  modules at once. Port and over-test it first.
- **Commitment calibration.** Hard-coded saturation points and weights are tuned to phase's deck corpus
  (40-card constructed assumptions in control's doc, Commander bracket tiers in `mod.rs`). manabrew's
  format/deck shapes may need recalibration; keep the formulas identical first, recalibrate only after
  count-parity is proven.
- **Net-new subsystem in forge-ai.** `deck_profile`, `strategy_profile`, `DeckArchetype`,
  `CommanderBracketTier`, and the policies that *consume* `DeckFeatures` do not yet exist in
  `forge-ai` (only `eval.rs`/`stats.rs`). The feature layer is inert until those consumers and the two
  upstream profilers are also ported — scope is larger than "12 files".
- **Shared-helper coupling.** aristocrats↔tokens_wide and aristocrats↔landfall share `pub(crate)`
  helpers; port them as shared utilities, not copies, to avoid divergent scope predicates.
- **Test fidelity.** phase tests build phase ASTs directly; they cannot be copied verbatim — they must
  be rewritten to construct forge IR (or assembled real cards), so the test suite is itself a port task
  with its own bug surface.
