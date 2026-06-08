# Foundation: effect-classification layer over manabrew's ability IR

Goal: give phase-ai's policies/features a way to ask "what does this card DO" in
terms of effect categories (removal, board wipe, tutor, ramp, draw, counterspell,
sac outlet, copy, pump, lifegain, discard, bounce, …), derived statically from
manabrew's ability IR.

This is the foundation layer: a pure, side-effect-free classifier over a
`Card`/`SpellAbility` that produces a set of categories. Policies and features
sit on top.

---

## 0. What phase-ai actually has (and what it doesn't)

The two upstream files are **not** a rich multi-label taxonomy. They are two
narrower mechanisms:

### `policies/effect_classify.rs` — polarity, not category
- Central enum `EffectPolarity { Beneficial, Harmful, Contextual }`.
- `effect_polarity(effect: &Effect) -> EffectPolarity` plus helpers:
  `counter_sign_polarity(&CounterType)`, `static_mode_polarity(&StaticMode)`,
  `modification_polarity(&ContinuousModification)`, `aura_polarity(&GameObject)`,
  `trigger_mode_polarity_for_host(..)`.
- This answers "should I point this at my own stuff or the opponent's" — a
  targeting/combat-trick signal, **not** "is this removal vs ramp".

### `cast_facts.rs` — a small boolean profile for draft/cast evaluation
- `struct CastFacts<'a>` aggregates a spell's reachable effects:
  `object`, `primary_effects: Vec<&AbilityDefinition>`,
  `immediate_etb_triggers`, `immediate_replacements`, `mana_value`,
  `profile: EffectProfile`, `requires_targets_in_spell_text`,
  `requires_targets_in_immediate_etb`.
- `EffectProfile` is a flat bag of booleans — the *only* category-like layer
  phase-ai ships today:
  `has_search_library`, `has_draw`, `has_token_creation`,
  `has_reveal_hand_or_discard`, `has_counter_spell`, `has_direct_removal_text`,
  `has_mass_damage_or_mass_shrink_text`.

**Conclusion for the port.** phase-ai's proven, in-use category set is exactly
those 7 `EffectProfile` flags plus the 3-way polarity. The richer list in the
task (tutor, ramp, sac outlet, copy, pump, lifegain, bounce, counters, tokens…)
is a *superset* we design here. We ground each requested category against
manabrew's IR, and flag the 7 phase-ai already validates as the cleanest tier.
forge-ai owns this taxonomy; manabrew's engine stays category-agnostic (the
engine deliberately ships **no** `ApiType → category` map — see api-ir.md §1).

---

## 1. The manabrew IR read-path (exact types and fields)

All paths under `forge-engine/crates/forge-engine/src/`. Public via the
`forge-engine-core` crate (forge-ai already depends on it as
`forge_engine_core`).

### 1.1 Getting the abilities off a card
- `CardState::get_intrinsic_spell_abilities(&self) -> Vec<SpellAbility>` —
  `card/card_state.rs:357`. Filters to printed `is_activated || is_trigger ||
  is_spell`. **This is the entry point for static classification.**
- `CardState::get_spell_abilities(&self) -> FCollectionView<SpellAbility>` —
  `:333` (includes granted/runtime abilities; use only if classifying live state).
- `CardState::get_mana_abilities(&self)` — `:337` (pre-filtered to mana abilities;
  shortcut for ramp detection).

### 1.2 The verb: `ApiType`
- `enum ApiType` — `ability/api_type.rs:11`, re-exported `ability::ApiType`.
  ~210 `Copy + Eq + Hash` variants. This is the primary classification key.
- `sa.api: Option<ApiType>` is the verb; `None` on DB/SVar glue leaves.

### 1.3 The runtime object: `SpellAbility` (`spellability/mod.rs:99`)
Fields the classifier reads:
- `api: Option<ApiType>` — `:104` — primary verb.
- `ir: SpellAbilityIr` — `:125` — lowered operand bag (§1.4).
- `sub_ability: Option<Box<SpellAbility>>` — `:138` — **chained DB$ effects;
  walk this** so multi-effect cards get every category.
- `pay_costs: Option<Cost>` — `:135` — activation cost (sac-outlet / activated
  removal live here, §1.6).
- `is_mana_ability: bool` — `:256`; `mana_part: Option<AbilityManaPart>` — `:223`.
- `is_spell / is_trigger / is_activated: bool` — `:143-147`.
- Helpers: `param_value(key) -> Option<&str>` (`:421`),
  `find_sub_ability_by_type(api) -> Option<&SpellAbility>` (`:676`),
  `can_this_produce() -> bool` (`:691`).
- Predicates in `spellability/spell_ability_predicates.rs`: `is_api(api)`,
  `has_sub_ability_api(api)`, `is_valid(&[&str])`.

### 1.4 The operands: `SpellAbilityIr` (`ability/ability_ir.rs:78`)
The structured bag (~400 `Default` fields). Classifier-relevant subsets:
- **Typed numeric effects**: `effect: Option<EffectIr>` (`:81`).
  `enum EffectIr { DamageAll | DealDamage(DealDamageIr) | Draw | GainLife |
  LifeSet | LoseLife | Mill | Poison }` (`:16`), each `NumericAmountIr` except
  `DealDamage`. Only these 8 APIs are lowered (`lower_effect_ir`, `:1272`);
  everything else is `None` → fall back to `*_text` / `param_value`.
- **What it hits (filters)**: `valid_filter_text`/`_selector` (`:88`),
  `valid_tgts_text`/`_selector` (`:103`), `valid_cards_text` (`:95`),
  `change_type`/`change_type_selector` (`:140`), `all_valid_text` (`:107`).
  `*_selector` are compiled `CompiledSelector`; `*_text` are raw strings.
- **Zones (direction — distinguishes tutor vs bounce vs exile-removal vs mill)**:
  `origin_zone: Option<ZoneType>` / `origin_zones: Vec<ZoneType>` (`:133-134`),
  `destination_zone` / `destination_zone_2` (`:136-137`),
  `zone1` / `zone2` (`:138-139`). `ZoneType` from `forge-foundation`.
  `hidden: bool` (`:206`) distinguishes a hidden library search (tutor) from a
  public reveal.
- **Counters**: `counter_type: Option<CounterType>` (`:247`),
  `counter_type_text`, `with_counters_type`, `with_counters_amount` (`:201-203`).
- **Amounts (when not lowered)**: `amount` (`:119`), `damage_amount_text` (`:245`),
  `num_dmg_present` (`:164`), `token_amount` (`:123`).
- **Tokens**: `token_script`, `token_name_text`, `token_power/_toughness`,
  `token_types_text` (`:191-196`).
- **Mana**: `produced_ir: Option<ProducedMana>` (`:84`), `mana_ability` flag.
- **Branch/charm glue**: `mode_text`, `true_sub_ability`/`false_sub_ability`,
  `branch_condition_svar`, `repeat`/`max_repeat` (`:82,113-116,121`).
- **Cost-side filter cached on IR**: `sac_valid: Option<String>` (`:124`).

### 1.5 Supporting operand types
- `AmountExpr { Literal(i32), SVar(String), Count(..), Raw(String) }` —
  `parsing/amount.rs:2`; `AmountExpr::parse(&str)`.
- `DefinedExpr { refs: Vec<DefinedRef> }` — `ability_ir.rs:1099`;
  `DefinedRef` (`:1117`): `SelfCard, You, Opponent, Targeted, Remembered,
  Sacrificed, … Unsupported(String)`.
- `ProducedMana { Any, Chosen, Combo(..), Special(String), Fixed(Vec<String>),
  Raw(String) }` — `ability/produced_mana.rs:11`; `is_any_like()`,
  `is_choice_like()`, `fixed_tokens()`.

### 1.6 Costs (sac outlet / activated removal): `Cost` (`cost/mod.rs:498`)
- `sa.pay_costs: Option<Cost>`; `Cost { parts: Vec<CostPart>, .. }` (`:498`).
- `enum CostPart` (`:234`) variants the classifier inspects:
  - `Sacrifice { amount, type_filter }` (`:260`) — `type_filter == "CARDNAME"`
    means "sacrifice self"; **any other filter on an `is_activated` ability ⇒
    sac outlet**.
  - `Tap` (`:236`), `Mana { .. }` (`:238`), `PayLife` (`:258`),
    `Discard` (`:265`), `Exile`/`ExileFromAnyGrave` (`:281-287`),
    `AddCounter`/`SubCounter` (`:270-279`).

---

## 2. Proposed forge-ai classification-module skeleton

New module `forge-ai/src/classify.rs` (sibling to `eval.rs`, `stats.rs`;
register `pub mod classify;` in `lib.rs`). forge-ai already imports
`forge_engine_core::{card::Card, ability::ApiType, ...}` style paths.

```rust
//! Static effect classification over the engine's ability IR.
//! Taxonomy owned here; the engine ships no ApiType->category map (api-ir.md §1).
//! Grounded in phase-ai's EffectProfile flags (cast_facts.rs) + extended.

use forge_engine_core::ability::{ApiType, SpellAbilityIr};
use forge_engine_core::ability::ProducedMana;
use forge_engine_core::cost::{Cost, CostPart};
use forge_engine_core::card::CardState;
use forge_engine_core::spellability::SpellAbility;
use forge_foundation::ZoneType;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum EffectCategory {
    Removal,        // targeted: Destroy/DealDamage/Fight/exile-ChangeZone/Sacrifice(one)
    BoardWipe,      // *All mass: DestroyAll/DamageAll/SacrificeAll/ChangeZoneAll
    Tutor,          // hidden ChangeZone Library->Hand/Battlefield, Dig/Seek/Learn
    Ramp,           // mana ability / mana-rock / land ChangeZone to battlefield
    Draw,           // Draw, Investigate, Discover
    Counterspell,   // Counter
    SacOutlet,      // activated ability w/ Sacrifice cost (filter != CARDNAME)
    Copy,           // CopyPermanent/CopySpellAbility/Clone
    Pump,           // Pump/PumpAll/Animate/+1/+1 PutCounter
    Lifegain,       // GainLife / SetLife(up) / ExchangeLife
    Lifeloss,       // LoseLife / Poison (drain pairs with Lifegain)
    Discard,        // Discard / RevealHand
    Bounce,         // ChangeZone Battlefield->Hand
    Mill,           // Mill, ChangeZone Library->Graveyard
    Counters,       // PutCounter(All)/RemoveCounter/Proliferate/MoveCounter
    Tokens,         // Token/Amass/Manifest/Cloak/Investigate/MakeCard
    Tapper,         // Tap/TapAll/Detain/Goad-style tempo
    Reanimation,    // ChangeZone Graveyard->Battlefield
    Untap,          // Untap/UntapAll (ritual/combo enabler)
    Other(ApiType), // verb recognized, no category mapping yet
}

/// A small set; most cards land 1-2 categories, charms/modal up to ~4.
pub type Categories = smallvec::SmallVec<[EffectCategory; 4]>;

/// Classify a single ability (walks its sub_ability chain).
pub fn classify_ability(sa: &SpellAbility) -> Categories;

/// Classify a whole card: union over get_intrinsic_spell_abilities().
pub fn classify_card(card: &CardState) -> Categories;

// ---- internals ----

/// Verb + operands -> categories for one node (no chain walk).
fn classify_node(api: ApiType, ir: &SpellAbilityIr, cost: Option<&Cost>) -> Categories;

/// True if any cost part sacrifices something other than self.
fn is_sac_outlet(cost: Option<&Cost>, is_activated: bool) -> bool;

/// ChangeZone direction -> Tutor | Bounce | Mill | Reanimation | Removal(exile).
fn classify_change_zone(ir: &SpellAbilityIr) -> Option<EffectCategory>;

/// Mana-ability / mana-rock / land-fetch detection.
fn classify_ramp(sa: &SpellAbility, ir: &SpellAbilityIr) -> bool;
```

Driver (mirrors api-ir.md §"Recommended classifier shape"):

```rust
pub fn classify_card(card: &CardState) -> Categories {
    let mut out = Categories::new();
    for sa in card.get_intrinsic_spell_abilities() {
        extend_unique(&mut out, classify_ability(&sa));
    }
    out
}

pub fn classify_ability(sa: &SpellAbility) -> Categories {
    let mut out = Categories::new();
    let mut cur = Some(sa);
    while let Some(s) = cur {
        if is_sac_outlet(s.pay_costs.as_ref(), s.is_activated) {
            push_unique(&mut out, EffectCategory::SacOutlet);
        }
        if classify_ramp(s, &s.ir) {
            push_unique(&mut out, EffectCategory::Ramp);
        }
        if let Some(api) = s.api {
            extend_unique(&mut out, classify_node(api, &s.ir, s.pay_costs.as_ref()));
        }
        cur = s.sub_ability.as_deref();
    }
    out
}
```

`classify_node` is a big `match api { .. }`. The cheat-sheet in api-ir.md §1 is
the seed map. Refinements that need IR operands:
- `ChangeZone` / `ChangeZoneAll` → delegate to `classify_change_zone` using
  `ir.origin_zone(s)` + `ir.destination_zone` + `ir.hidden`:
  Library→Hand/Battlefield (hidden) = Tutor; Battlefield→Hand = Bounce;
  Battlefield/Library→Exile = Removal; Library→Graveyard = Mill;
  Graveyard→Battlefield = Reanimation. `*All` variants additionally add BoardWipe.
- `PutCounter`/`PutCounterAll` → Counters; if `ir.counter_type` is `P1P1` also Pump.
- `GainLife` magnitude/`ExchangeLife` → Lifegain; paired `LoseLife` sub-ability ⇒
  drain (Lifegain + Lifeloss + often Removal if damage-based).
- `Mana`/`ManaReflected` or `s.is_mana_ability` → Ramp.

(`Effect`/`charm`/`branch` nodes carry their payload in sub-abilities, so the
chain walk already covers modal spells; no special handling beyond walking
`true_sub_ability`/`false_sub_ability` names if they reference SVar-stored
sub-abilities — see "needs work" below.)

---

## 3. Mapping table: clean vs needs-work vs infeasible

| Category | Source signal | Tier | Notes |
|---|---|---|---|
| **Draw** | `ApiType::Draw`; `EffectIr::Draw`; +`Investigate`/`Discover` | **Clean** | phase-ai `has_draw`. Direct verb + typed EffectIr. |
| **Counterspell** | `ApiType::Counter` | **Clean** | phase-ai `has_counter_spell`. One verb. |
| **Board wipe** | `DestroyAll`/`DamageAll`/`SacrificeAll`/`ChangeZoneAll`/`EachDamage` | **Clean** | phase-ai `has_mass_damage_or_mass_shrink_text`. Verb-only. |
| **Lifegain** | `GainLife`/`SetLife`; `EffectIr::GainLife`/`LifeSet` | **Clean** | Typed EffectIr; SetLife up-vs-down needs amount sign. |
| **Discard** | `Discard`/`RevealHand` | **Clean** | phase-ai `has_reveal_hand_or_discard`. Verb-only. |
| **Counters** | `PutCounter(All)`/`RemoveCounter`/`Proliferate`/`MoveCounter` + `ir.counter_type` | **Clean** | Verbs + `counter_type` enum present. |
| **Tokens** | `Token`/`Amass`/`Manifest`/`Cloak`/`Investigate`/`MakeCard` | **Clean** | phase-ai `has_token_creation`. Verb set. |
| **Pump** | `Pump`/`PumpAll`/`Animate`; `PutCounter` with `counter_type==P1P1` | **Clean** | Verb + counter-type refinement; both available. |
| **Tapper / Untap** | `Tap`/`TapAll`; `Untap`/`UntapAll` | **Clean** | Verb-only. |
| **Removal (targeted)** | `Destroy`/`DealDamage`/`Fight`/`Sacrifice`(single)/`RemoveFromGame` + exile `ChangeZone` | **Needs work** | phase-ai `has_direct_removal_text`. Most verbs clean, but exile-removal requires reading `ir.destination_zone==Exile`, and "DealDamage to a creature vs to face" needs `ir.valid_tgts`/`DealDamageIr.valid_targets` to separate removal from burn-to-face. |
| **Bounce** | `ChangeZone` Battlefield→Hand | **Needs work** | Needs `origin_zone==Battlefield && destination_zone==Hand`. Direction logic only; zones are on IR. |
| **Tutor** | `ChangeZone` Library→Hand/Battlefield (`hidden`); `Dig`/`DigUntil`/`Seek`/`Learn` | **Needs work** | phase-ai `has_search_library`. `Dig*`/`Seek` verbs clean; `ChangeZone` form needs origin+destination+`hidden`. Distinguishing tutor-to-hand vs ramp land-fetch needs `change_type` filter (land vs any). |
| **Ramp** | `is_mana_ability`/`mana_part`/`Mana`/`ManaReflected`; land `ChangeZone`→Battlefield | **Needs work** | Mana-ability path clean via `is_mana_ability`. But "mana rock vs land-fetch vs cost-reducer ritual" split needs `produced_ir` (`ProducedMana`) inspection + `change_type` land filter. Cost reducers (static) are out of this IR path entirely. |
| **Mill / Reanimation** | `Mill`/`EffectIr::Mill`; `ChangeZone` GY→BF | **Needs work** | Mill verb clean; reanimation is a `ChangeZone` direction case. |
| **Sac outlet** | `pay_costs` `CostPart::Sacrifice{type_filter != "CARDNAME"}` on `is_activated` | **Needs work** | Signal is on the **cost**, not the API (api-ir.md §6). Logic is simple but lives in a different field; must also exclude "sacrifice self" (`CARDNAME`) which is a cost, not an outlet. |
| **Copy** | `CopyPermanent`/`CopySpellAbility`/`Clone` | **Needs work** | Verbs exist and are clean to detect, but the *value* of a copy (what it copies) needs `defined`/`ir` context that's often SVar-driven; category tag itself is clean, refinement is hard. |
| **Drain (lifegain+lifeloss combo)** | `GainLife` sub + `LoseLife`/damage sub on same chain | **Needs work** | Requires correlating two nodes in the sub-ability chain; chain walk supports it but it's a cross-node rule. |
| **Cost reducers / "ramp" via static** | static abilities, not spell abilities | **Infeasible (this layer)** | Affinity/cost-reduction/"spells cost less" live in `staticability/`, not in `SpellAbility` IR. Out of scope for a `SpellAbility`-walking classifier; needs a separate static-ability pass. |
| **Stax / "can't" effects** | continuous `StaticMode` (CantAttack/CantUntap…) | **Infeasible (this layer)** | Same: continuous/static layer. phase-ai handles these via `static_mode_polarity`, a different input type (`StaticMode`), not the ability IR. |
| **SVar-gated modal payloads** | `true_sub_ability`/`false_sub_ability` referencing SVar-stored abilities | **Infeasible (eager)** | Per engine rule (forge-engine AGENTS.md: "minimize SVar parsing, resolve lazily"), the classifier should **not** eagerly expand SVar sub-ability graphs. Charm/branch nodes whose branches are SVar names won't be fully classified statically without resolving SVars — accept partial classification (tag `Other` / the branch verb) rather than force-resolve. |
| **Combat-trick polarity (Beneficial/Harmful/Contextual)** | n/a | **Separate axis** | phase-ai's `EffectPolarity` is orthogonal to category. Port it separately over `staticability`/`ContinuousModification` inputs; do **not** fold into `EffectCategory`. |

---

## 4. Recommended build order

1. Land `EffectCategory` + the verb-only **Clean** tier (Draw, Counterspell,
   BoardWipe, Lifegain, Discard, Counters, Tokens, Pump, Tapper/Untap). This
   already reproduces 6 of phase-ai's 7 `EffectProfile` flags from real IR.
2. Add the `classify_change_zone` direction helper → unlocks Tutor, Bounce,
   Mill, Reanimation, exile-Removal in one shot (all gated on the same
   `origin_zone`/`destination_zone`/`hidden` reads).
3. Add `is_sac_outlet` (cost-side) and `classify_ramp` (mana-ability) — the two
   non-API signals.
4. Defer drain-correlation, copy-value refinement, and the static/SVar tiers;
   tag them `Other` until a static-ability pass and lazy SVar resolution exist.

Keep the module **pure** (no `&Game`, no mutation) so phase-ai features can call
it on cloned/snapshot state and on raw card DB entries during draft (matching
`CastFacts`' draft-evaluation use). For a no-engine path (deckbuild/draft before
a `Game` exists), the same logic runs on `forge-card-script`'s
`ParsedCardScript`/`ParsedParams` (api-ir.md §7) — same `ApiType` strings, same
param keys — but that should be a thin second front-end over the same category
rules, not a fork.
