# Port spec — `phase-ai::draft_eval` → `forge-ai::draft_eval`

Source: `phase-rs/phase` `crates/phase-ai/src/draft_eval.rs` (fetched verbatim 2026-06-08).
Target: a new `forge-ai` crate in the manabrew workspace, module `draft_eval.rs`.
Engine API maps used: `tmp/phaseai-port/api-state.md`, `api-ir.md`, `api-combat-mana.md`, `api-sim.md`.
Engine src root in citations: `forge-engine/crates/forge-engine/src/` unless a `forge-foundation/` path is given.

---

## 1. What it does (the AI logic)

A **context-free draft-pick quality heuristic**: a pure function `evaluate_draft_card(face, weights) -> f64`
that scores a single card's intrinsic value for Limited draft, plus a `rarity_prior(rarity) -> f64`
blend term that callers add separately. No game state, no pick/deck context. Two consumers in
phase (`draft-wasm::bot_ai` drafter and `draft-wasm::suggest` auto-builder) share it.

Scoring algorithm (exact order, from source):

1. Read core types. `is_creature = core.contains(Creature)`, `is_planeswalker = core.contains(Planeswalker)`.
2. **Land short-circuit** — if not creature and not planeswalker but is Land: return `fixing_land`
   if `produced_color_count(face) >= 2`, else `0.0`. (Checked *after* creature/PW tests so manlands
   and Dryad Arbor score on their bodies.)
3. **Effect-chain value** — build `EffectProfile::from_face(face)` (dependency module) and sum weights
   for each boolean flag set: `removal`, `mass_removal`, `draw`, `token`, `counter`, `search`.
4. **Modal scaling** — multiply the effect-chain subtotal by
   `modal_factor = min(1.0, max_choices / max(1, mode_count))` (1.0 for non-modal). Modal cards
   over-count effect flags (every mode registers), so scale down to the fraction actually resolved.
5. **Body value** — if creature: `score += creature_flat + (combat_value / mana_value) * creature_efficiency`,
   where `mana_value = max(1, mv)` and `combat_value = creature_combat_value(power, toughness, kw_closure, &keyword_weights)`
   (dependency module). `*`/variable P/T are treated as absent (→0).
6. **Planeswalker** — if planeswalker: `score += planeswalker_flat`.
7. **Static abilities** — `score += min(static_ability_cap, static_abilities.len() * static_ability_each)`.

`evaluate_draft_card_default(face)` = step 1–7 with `DraftWeights::default()`.

The module owns only: the `DraftWeights` struct + its `Default`, `rarity_prior`, the scoring function,
`produced_color_count` (a thin delegator), and `fixed_pt`. All effect-classification, combat-value,
and mana-color logic lives in **dependency modules** (§4).

---

## 2. Every Phase type/API it reads → manabrew equivalent

| Phase symbol (read) | Role in module | manabrew equivalent | cite |
|---|---|---|---|
| `engine::types::card::CardFace` | the scored unit (static card data) | **`Card`** (per-printing template from the card DB; built via `ability_factory`) — no distinct "face" type | `card/mod.rs:197` |
| `face.card_type.core_types: Vec<CoreType>` | creature/PW/land tests | `Card.type_line.core_types: BTreeSet<CoreType>` (`.contains(&CoreType::X)` works) | `forge-foundation/card_type.rs` (CardTypeLine.core_types); access via `card.type_line` `card/mod.rs:215` |
| `engine::types::card_type::CoreType` (`Creature`,`Planeswalker`,`Land`,`Instant`…) | type enum | **direct equiv** `forge-foundation::card_type::CoreType` | `forge-foundation/card_type.rs:6` |
| `face.card_type.subtypes` | fixing-land color union | `Card.type_line.subtypes: Vec<String>` | `forge-foundation/card_type.rs` (CardTypeLine.subtypes) |
| `face.power / face.toughness: Option<PtValue>` | body stats | `Card.base_power / base_toughness: Option<i32>` | `card/mod.rs:231,232` |
| `engine::types::ability::PtValue` (`Fixed(i32)` / `Variable(String)`) | filter out `*`/derived P/T | **NO equiv** — manabrew stores P/T as plain `Option<i32>`; `*`/CDA cards have `base_power = None` (computed later by a static). `fixed_pt` collapses to `card.base_power` (None→absent). | n/a |
| `face.mana_cost.mana_value()` | normaliser | `Card.mana_cost.cmc() -> i32` | `mana_cost` field `card/mod.rs:218`; `ManaCost::cmc` `forge-foundation/mana.rs:505` |
| `face.keywords.contains(kw)` (closure into `creature_combat_value`) | keyword bonuses | `Card.has_keyword_enum(Kw) -> bool` | `card/mod.rs:1269`; `Keyword` enum `keyword/keyword_instance.rs:186` |
| `face.modal: Option<Modal{max_choices, mode_count}>` | modal down-scaling | **NO struct equiv** — derive from the `ApiType::Charm` spell ability: `mode_count` = `sa.ir.choices` split on `','` count; `max_choices` = `CharmNum$` param (default 1). | `ApiType::Charm` `ability/api_type.rs:44`; `ir.choices` `ability/ability_ir.rs:173`; semantics in `ability/effects/charm_effect.rs:49-56` (`Choices$`, `keys::CHARM_NUM` default 1) |
| `face.static_abilities: Vec<_>` (`.len()`) | static-ability proxy | `Card.static_abilities: Vec<StaticAbility>` (`.len()`) | `card/mod.rs:368` |
| `face.abilities` / `face.triggers` (consumed by `EffectProfile::from_face`) | effect classification source | `Card.triggers: Vec<Trigger>` `card/mod.rs:389`; abilities via `CardState::get_intrinsic_spell_abilities() -> Vec<SpellAbility>` (printed SP/AB/ST) | `card/card_state.rs:357`; triggers `card/mod.rs:389` |
| `crate::cast_facts::EffectProfile` + `::from_face` | removal/draw/token/counter/search flags | **dependency module** `forge-ai::cast_facts` — must classify via `sa.api: ApiType` + `SpellAbilityIr` (see api-ir.md §1 cheat-sheet). No phase `Effect` enum exists. | api-ir.md §1–3 |
| `crate::eval::creature_combat_value` | body→value formula | **dependency module** `forge-ai::eval` (engine-agnostic math) | api-state.md `power()`/`toughness()` for live use; here static `base_power` |
| `crate::eval::KeywordBonuses` | keyword weight table | **dependency module** `forge-ai::eval` | — |
| `crate::mana_colors::land_produced_color_types(subtypes, abilities)` | distinct producible colors | **dependency module** `forge-ai::mana_colors`; manabrew primitives: `basic_land_mana_atom(card)` `mana/mod.rs:406`, `land_mana_atoms(card)` `mana/mod.rs:634`, `mana_atom_from_produced` `mana/mod.rs:431` | api-combat-mana.md "Mana production" |
| `rarity: &str` (in `rarity_prior`) | rarity prior | manabrew `Rarity` enum (`Mythic`/`Rare`/`Uncommon`/`Common`/…). Either keep `&str` or take `&Rarity` and match variants. | `forge-foundation/sealed_product/rarity.rs:5` |

**No-equivalent flags:** `PtValue` (collapses to `Option<i32>`; minor) and `Modal` struct
(must be reconstructed from the Charm IR; see §5). Everything else has a direct or
dependency-module equivalent.

---

## 3. Faithful-port plan + Rust skeleton

Weights, formulas, and thresholds are carried **verbatim**. Only the data-access layer
(`CardFace` → `Card`, `PtValue` → `Option<i32>`, `modal` → Charm IR) is adapted.

```rust
//! Draft-pick evaluation: one card-quality heuristic shared by the bot drafter
//! and the post-draft "Suggest Deck" auto-builder. Faithful port of
//! phase-ai::draft_eval onto the Forge-DSL engine.
//!
//! Known limitations (carried from phase): MDFC/split/adventure scored on primary
//! face only; modal cards scaled by max_choices/mode_count; mana-dorks not rewarded
//! beyond stats; static-ability value is a flat per-count proxy; keyword weights are
//! borrowed from board evaluation (KeywordBonuses) and are not draft-tuned.

use serde::{Deserialize, Serialize};

use forge_engine::card::Card;
use forge_engine::keyword::keyword_instance::Keyword;
use forge_foundation::card_type::CoreType;

use crate::cast_facts::EffectProfile;
use crate::eval::{creature_combat_value, KeywordBonuses};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DraftWeights {
    pub keyword: KeywordBonuses,
    pub creature_flat: f64,
    pub creature_efficiency: f64,
    pub planeswalker_flat: f64,
    pub removal: f64,
    pub mass_removal: f64,
    pub draw: f64,
    pub token: f64,
    pub counter: f64,
    pub search: f64,
    pub static_ability_each: f64,
    pub static_ability_cap: f64,
    pub fixing_land: f64,
}

impl Default for DraftWeights {
    fn default() -> Self {
        Self {
            keyword: KeywordBonuses::default(),
            creature_flat: 1.0,
            creature_efficiency: 1.0,   // body = combat_value / mana_value · this; kept ≤1
            planeswalker_flat: 5.0,
            removal: 4.0,
            mass_removal: 5.0,
            draw: 2.0,
            token: 1.5,
            counter: 1.0,
            search: 0.5,
            static_ability_each: 0.75,
            static_ability_cap: 2.0,
            fixing_land: 2.0,
        }
    }
}

pub fn rarity_prior(rarity: &str) -> f64 {
    match rarity {
        "mythic" => 1.5,
        "rare" => 1.0,
        "uncommon" => 0.4,
        _ => 0.0,
    }
}
// If taking the engine enum instead of &str:
// pub fn rarity_prior(r: Rarity) -> f64 {
//     match r { Rarity::Mythic => 1.5, Rarity::Rare => 1.0, Rarity::Uncommon => 0.4, _ => 0.0 }
// }

pub fn evaluate_draft_card(card: &Card, w: &DraftWeights) -> f64 {
    let core = &card.type_line.core_types; // BTreeSet<CoreType>
    let is_creature = core.contains(&CoreType::Creature);
    let is_planeswalker = core.contains(&CoreType::Planeswalker);

    // Land short-circuit (after creature/PW tests so manlands score on their body).
    if !is_creature && !is_planeswalker && core.contains(&CoreType::Land) {
        return if produced_color_count(card) >= 2 {
            w.fixing_land
        } else {
            0.0
        };
    }

    // ── Effect-chain value ──────────────────────────────────────────────
    let profile = EffectProfile::from_card(card);
    let mut effect_score = 0.0;
    if profile.has_direct_removal_text {
        effect_score += w.removal;
    }
    if profile.has_mass_damage_or_mass_shrink_text {
        effect_score += w.mass_removal;
    }
    if profile.has_draw {
        effect_score += w.draw;
    }
    if profile.has_token_creation {
        effect_score += w.token;
    }
    if profile.has_counter_spell {
        effect_score += w.counter;
    }
    if profile.has_search_library {
        effect_score += w.search;
    }
    let modal_factor = match modal_dims(card) {
        Some((max_choices, mode_count)) => {
            (max_choices as f64 / mode_count.max(1) as f64).min(1.0)
        }
        None => 1.0,
    };
    let mut score = effect_score * modal_factor;

    // ── Body value ──────────────────────────────────────────────────────
    if is_creature {
        let power = card.base_power.unwrap_or(0);
        let toughness = card.base_toughness.unwrap_or(0);
        let mv = card.mana_cost.cmc().max(1) as f64;
        let combat = creature_combat_value(
            power,
            toughness,
            |kw: Keyword| card.has_keyword_enum(kw),
            &w.keyword,
        );
        score += w.creature_flat + combat / mv * w.creature_efficiency;
    }
    if is_planeswalker {
        score += w.planeswalker_flat;
    }

    // ── Static abilities ────────────────────────────────────────────────
    score +=
        (card.static_abilities.len() as f64 * w.static_ability_each).min(w.static_ability_cap);

    score
}

pub fn evaluate_draft_card_default(card: &Card) -> f64 {
    evaluate_draft_card(card, &DraftWeights::default())
}

pub fn produced_color_count(card: &Card) -> usize {
    crate::mana_colors::land_produced_color_count(card)
}

/// (max_choices, mode_count) for a Charm/modal card, else None.
/// Replaces phase's `face.modal`. Scans printed spell abilities for ApiType::Charm.
fn modal_dims(card: &Card) -> Option<(usize, usize)> {
    for sa in card.get_intrinsic_spell_abilities() {
        let mut cur = Some(&sa);
        while let Some(s) = cur {
            if s.api == Some(ApiType::Charm) {
                let choices = s.ir.choices.as_deref().unwrap_or("");
                if !choices.is_empty() {
                    let mode_count = choices.split(',').filter(|m| !m.trim().is_empty()).count();
                    let max_choices = s
                        .param_value(keys::CHARM_NUM)
                        .and_then(|v| v.parse::<usize>().ok())
                        .unwrap_or(1);
                    return Some((max_choices, mode_count));
                }
            }
            cur = s.sub_ability.as_deref();
        }
    }
    None
}
```

Notes for the implementer:
- `fixed_pt` from phase disappears: manabrew P/T is already `Option<i32>`, and the
  `unwrap_or(0)` matches phase's behavior for absent/`*` stats (the
  `variable_power_creature_does_not_panic` invariant holds trivially).
- The land short-circuit, modal scaling, body formula, static-ability cap, and **every weight
  literal** are byte-for-byte the same numbers as phase. Do not retune in this port.
- `card.get_intrinsic_spell_abilities()` requires the `Card` to be a built template
  (`ability_factory`-populated). The card-DB templates qualify; a bare deck-list string does not.

---

## 4. Dependencies on other phase-ai modules (port these first)

`draft_eval` is **thin glue**; the engine-specific work is in three sibling modules it imports:

1. **`crate::cast_facts::EffectProfile`** (`EffectProfile::from_face` → port as `from_card`).
   Largest dependency. Phase reads its typed `Effect` enum off `face.abilities`/`face.triggers`.
   manabrew has no `Effect` enum — rebuild the six booleans by walking
   `get_intrinsic_spell_abilities()` + `sub_ability` chain and matching `sa.api: ApiType` (+ IR
   operands) per api-ir.md §1:
   - `has_direct_removal_text` ← `Destroy`, single-target `DealDamage`/`Fight`, `Sacrifice` (targeted), exile `ChangeZone`
   - `has_mass_damage_or_mass_shrink_text` ← `DestroyAll`, `DamageAll`, `SacrificeAll`, negative `PumpAll`
   - `has_draw` ← `Draw`
   - `has_token_creation` ← `Token`, `Amass`, `Manifest`, `Investigate`
   - `has_counter_spell` ← `Counter`
   - `has_search_library` ← `ChangeZone` (Origin Library→Hand/Battlefield), `Dig*`, `Seek`
   Must also expose `from_card(&Card)`.
2. **`crate::eval`** — `creature_combat_value(power, toughness, kw_closure, &KeywordBonuses) -> f64`
   and `KeywordBonuses` (struct + `Default`). Engine-agnostic math, but the keyword closure type
   changes to manabrew's `Keyword` enum. Port `eval` first so `DraftWeights.keyword` resolves.
3. **`crate::mana_colors`** — `land_produced_color_types(subtypes, abilities)`; port as
   `land_produced_color_count(&Card) -> usize` over manabrew primitives `basic_land_mana_atom`
   (`mana/mod.rs:406`) + `land_mana_atoms` (`mana/mod.rs:634`), counting *distinct colored*
   atoms (exclude `COLORLESS=32`, `GENERIC=64`; see `ManaAtom`, `forge-foundation/mana.rs:9`).
   The colorless-only-land test must yield 0.

No dependency on phase's `cards`/`game` simulation modules — this is pure static-data scoring.

---

## 5. Risks — adapt vs infeasible

**Feasible, needs adaptation:**
- **`Modal` → Charm IR (medium).** Phase's `face.modal{max_choices, mode_count}` becomes a scan
  for `ApiType::Charm` reading `ir.choices` (mode list) and `CharmNum$` (max). Confirmed present
  (`charm_effect.rs:49-56`). Edge cases: Escalate/Entwine inflate effective `CharmNum` at cast
  time (`charm_effect.rs:143`) — for static draft scoring, use the printed `CharmNum$` default 1,
  matching phase's printed-data view. Modal-DFC "choose a face" is **not** Charm and is out of scope
  (same MDFC blind spot phase documents).
- **`PtValue::Variable("*")` → `Option<i32>` (low).** manabrew lacks the Fixed/Variable split;
  `*`/CDA creatures carry `base_power = None`. `unwrap_or(0)` reproduces phase's "ignore derived
  stats" behavior. Minor under-rating of CDA creatures, identical in spirit to phase.
- **`CardFace` → `Card` template (low/medium).** No per-face record; MDFC/split/adventure are
  separate `Card` instances or face-state toggles. Scoring the primary face only is exactly phase's
  documented limitation, so this is parity-preserving — but the caller must pass the right
  `Card` template, and `get_intrinsic_spell_abilities()` requires a *built* card, not a raw name.
- **`EffectProfile` classification fidelity (medium).** The six booleans now derive from
  `ApiType`+IR rather than a typed `Effect` enum. Risk of over/under-classifying removal
  (e.g. `DealDamage` mass vs single needs the target-filter/`DamageAll` distinction) and tutor
  vs bounce (`ChangeZone` direction via `ir.origin_zone`/`ir.destination_zone`). This risk lives
  in the `cast_facts` port, not here, but it directly drives `draft_eval`'s effect tier.

**No infeasible parts.** All inputs are static card data available on a built `Card` template;
nothing requires live game state, the stack, or simulation. The Forge-DSL engine exposes every
field the heuristic needs (types, P/T, CMC, keywords, static abilities, triggers, mana production).
The only "soft" risk is classification accuracy in the dependency modules, not the scoring math —
which ports verbatim.
