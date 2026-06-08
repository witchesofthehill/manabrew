# Port spec — `phase-ai/src/threat_profile.rs` → `forge-ai/threat_profile.rs`

Source: `https://raw.githubusercontent.com/phase-rs/phase/main/crates/phase-ai/src/threat_profile.rs`
Target engine: manabrew `forge-engine` (Forge-DSL). All engine paths below relative to
`forge-engine/crates/forge-engine/src/` unless noted.

---

## 1. What it does (the AI logic)

Opponent-hand threat estimation for the bot. Given the opponent's *remaining* deck pool
(library + hand, i.e. cards the AI hasn't seen leave), it estimates the probability that
the opponent is holding at least one card of each of five threat categories:
`counterspell`, `targeted_removal`, `board_wipe`, `combat_trick`, `direct_damage`.

Pipeline:

1. **`classify_card_face`** — static, per-card classification. Walks every ability (and its
   `sub_ability` chain) of a card face and tags it into 0+ categories by inspecting the
   effect verb. Pure function of the card's printed abilities + whether the card is an Instant.
2. **`build_threat_profile`** — iterates the opponent's remaining-deck view, classifies each
   distinct card, and accumulates per-category **`CategoryPool`**s: a total `count`, a
   `min_mana_value`, and a `by_mana_cost: [u32; 8]` histogram (index = mana value, bucket 7 =
   "7 or more"). Then computes the at-least-one probability per category via the
   **hypergeometric** tail and records archetype + pool size + hand size.
3. **`hypergeometric_at_least_one(N, K, n)`** — `P(≥1 success) = 1 − C(N−K,n)/C(N,n)`,
   computed as an iterative ratio product to avoid factorial overflow. N = pool size,
   K = threat count, n = hand size.
4. **`castable_probabilities`** — eval-time (not build-time) recompute that **mana-gates**
   each category: only counts cards whose mana value ≤ the opponent's currently available
   mana (`CategoryPool::castable_count`). Reuses the precomputed histogram so no re-scan.
5. **`build_threat_profile_multiplayer`** — picks the single "highest-threat" opponent
   (`max_by_key` on `(available_mana, hand_size)`) and profiles them.
6. **`ArchetypeBaseProbabilities::for_archetype`** — a hardcoded fallback table of
   conservative per-archetype probabilities used by Medium difficulty (skips per-card
   analysis). Values are **verbatim constants** (see §3).

This is a self-contained statistics + classification module; the only "engine" touch points
are (a) reading the opponent's hand size, (b) reading a card's mana value, (c) reading a
card's abilities/effects for classification, and (d) computing available mana.

---

## 2. Phase engine types/APIs read → manabrew equivalents

Phase reads a strongly-typed effect model (`engine::types::ability::Effect`, a closed enum).
Manabrew has **no such typed enum**: effects are keyed by `ApiType` (the `SP$/AB$/DB$` verb)
plus a string/IR operand bag (`SpellAbilityIr`). This is the central adaptation (see §5).

| Phase API (in this file)                                   | manabrew equivalent | cite |
|------------------------------------------------------------|---------------------|------|
| `engine::types::game_state::GameState`                     | `GameState` (aka `Game`) | game.rs:92 |
| `engine::types::player::PlayerId`                          | `PlayerId(pub u32)`, `.index()` | ids.rs:9 / ids.rs:18 |
| `state.players[opp.0 as usize].hand.len()`                 | `game.cards_in_zone(ZoneType::Hand, opp).len()` | game.rs:520 |
| `engine::game::players::opponents(state, ai)`              | `PlayerCollection::opponents_of(game, ai).0` (`Vec<PlayerId>`) | player/player_collection.rs:36 |
| `card.mana_cost.mana_value() -> u32`                       | `Card::mana_value(&self) -> i32` (= `mana_cost.cmc()`); cast `.max(0) as u32` | card/mod.rs:1395; ManaCost::cmc forge-foundation/src/mana.rs:505 |
| `card.card_type.core_types.contains(&CoreType::Instant)`   | `card.type_line.core_types.contains(&CoreType::Instant)` (`BTreeSet<CoreType>`) | forge-foundation/src/card_type.rs:153; CoreType is in forge-foundation |
| `CardFace { abilities: Vec<AbilityDefinition>, .. }`       | `CardState::get_intrinsic_spell_abilities() -> Vec<SpellAbility>` (printed abilities only) | card/card_state.rs:357 |
| `AbilityDefinition.effect: Effect`                         | `SpellAbility.api: Option<ApiType>` (+ `sa.ir`) | spellability/mod.rs:104 |
| `AbilityDefinition.sub_ability: Option<Box<..>>`           | `SpellAbility.sub_ability: Option<Box<SpellAbility>>` | spellability/mod.rs:138 |
| `Effect::Counter`                                          | `ApiType::Counter` | ability/api_type.rs (variant) |
| `Effect::DestroyAll` / `Effect::DamageAll`                 | `ApiType::DestroyAll` / `ApiType::DamageAll` | api-ir.md §1 board-wipe row |
| `Effect::Destroy`                                          | `ApiType::Destroy` | api-ir.md removal row |
| `Effect::DealDamage { target }`                            | `ApiType::DealDamage`; target via `sa.target_restrictions` / `ir.valid_tgts_text` | spellability/mod.rs:129; ability_ir.rs:88-141 |
| `Effect::Pump` (instant)                                   | `ApiType::Pump` (and arguably `ApiType::PumpAll`, `ApiType::Animate`) | api-ir.md pump row |
| `Effect::ChangeZone { destination: Exile\|Graveyard }`     | `ApiType::ChangeZone` + `ir.destination_zone ∈ {Exile, Graveyard}` | ability_ir.rs:133-139 |
| `Effect::Bounce`                                           | **no `Bounce` ApiType** — bounce = `ApiType::ChangeZone` + `ir.destination_zone == Hand` (from Battlefield) | api-ir.md bounce row |
| `engine::types::ability::TargetFilter::Any`                | **no enum** — "any target" must be derived from `TargetRestrictions` / `ValidTgts$` allowing `Player` | spellability/mod.rs:129 (TargetRestrictions); ability_ir.rs:88-141 |
| `engine::types::zones::Zone`                               | `ZoneType` (Exile, Graveyard, Hand, Battlefield…) | forge-foundation/src/zone.rs:5 |
| `crate::zone_eval::available_mana(state, opp) -> u32`      | **sibling port** (zone_eval). Manabrew primitive: `calculate_available_mana(pool, game, player).total_mana() -> i32` | mana/mod.rs:879; mana_pool.rs:200 |

**Items with NO direct manabrew equivalent (flagged):**

- **`Effect` typed enum** — manabrew has no closed effect enum; classification must switch on
  `ApiType` + inspect `SpellAbilityIr`. Largest adaptation.
- **`Effect::Bounce`** — folds into `ApiType::ChangeZone` (destination Hand). No standalone verb.
- **`TargetFilter::Any`** — no boolean "any target" flag. Must inspect target restrictions /
  `ValidTgts$` text to decide whether a `DealDamage` can hit a player (→ `direct_damage`).
- **`zone_eval::available_mana` returning `u32`** — manabrew's `calculate_available_mana`
  returns a full `ManaPool`; you take `.total_mana()` and clamp to `u32`. Provided by the
  sibling `zone_eval` port, not this module.
- **`CardFace`** — manabrew deck entries are `CardRules`/`Card`/`CardState`, not a "face"
  struct. The deck-knowledge port supplies the iterable; classification consumes a
  `&CardState` (or pure `forge_card_script::ParsedCardScript`, see §5 risk).

---

## 3. Faithful-port plan + Rust skeleton

The **statistics half is engine-agnostic — port the bodies verbatim** (numbers must match
exactly). Only `classify_*`, the deck iteration in `build_threat_profile`, hand-size,
mana-value, opponents, and `available_mana` touch the engine.

```rust
use forge_engine::game::GameState;
use forge_engine::ids::PlayerId;
use forge_engine::ability::api_type::ApiType;
use forge_engine::spellability::SpellAbility;
use forge_foundation::{CoreType, ZoneType};

use crate::deck_knowledge::{remaining_deck_view, RemainingDeckView}; // sibling port
use crate::deck_profile::{DeckArchetype, DeckProfile};               // sibling port
use crate::zone_eval::available_mana;                                // sibling port

// ── Verbatim data types ───────────────────────────────────────────────

#[derive(Debug, Clone, Default)]
pub struct ThreatProbabilities {
    pub counterspell: f64,
    pub targeted_removal: f64,
    pub board_wipe: f64,
    pub combat_trick: f64,
    pub direct_damage: f64,
}

#[derive(Debug, Clone, Default)]
pub struct ThreatCategoryPools {
    pub counterspell: CategoryPool,
    pub targeted_removal: CategoryPool,
    pub board_wipe: CategoryPool,
    pub combat_trick: CategoryPool,
    pub direct_damage: CategoryPool,
}

#[derive(Debug, Clone, Default)]
pub struct CategoryPool {
    pub count: u32,
    pub min_mana_value: u32,
    pub by_mana_cost: [u32; 8], // index = mana value, index 7 = "7+"
}

impl CategoryPool {
    fn add(&mut self, mana_value: u32, count: u32) {
        self.count += count;
        let bucket = (mana_value as usize).min(7);
        self.by_mana_cost[bucket] += count;
        if self.count == count {
            self.min_mana_value = mana_value;
        } else {
            self.min_mana_value = self.min_mana_value.min(mana_value);
        }
    }

    fn castable_count(&self, max_mana: u32) -> u32 {
        let limit = (max_mana as usize).min(7);
        self.by_mana_cost[..=limit].iter().sum()
    }
}

#[derive(Debug, Clone)]
pub struct ThreatProfile {
    pub probabilities: ThreatProbabilities,
    pub opponent_archetype: DeckArchetype,
    pub category_pools: ThreatCategoryPools,
    pub pool_size: u32,
    pub hand_size: u32,
}

// ── Verbatim statistics (engine-agnostic — copy exactly) ──────────────

pub fn hypergeometric_at_least_one(pool_size: u32, threat_count: u32, hand_size: u32) -> f64 {
    if pool_size == 0 || hand_size == 0 {
        return 0.0;
    }
    let threat_count = threat_count.min(pool_size);
    if threat_count >= pool_size {
        return 1.0;
    }
    if hand_size >= pool_size {
        return 1.0;
    }
    let n = pool_size as f64;
    let k = threat_count as f64;
    let mut p_zero = 1.0;
    for i in 0..hand_size {
        let fi = i as f64;
        p_zero *= (n - k - fi) / (n - fi);
        if p_zero <= 0.0 {
            return 1.0;
        }
    }
    (1.0 - p_zero).clamp(0.0, 1.0)
}

// ── Classification (ADAPTED: ApiType + IR instead of typed Effect) ────

pub fn classify_card_face(card: &CardState) -> ThreatProbabilities {
    let mut probs = ThreatProbabilities::default();
    let is_instant = card.type_line.core_types.contains(&CoreType::Instant);
    for sa in card.get_intrinsic_spell_abilities() {
        classify_ability(&mut probs, &sa, is_instant);
    }
    probs
}

fn classify_ability(probs: &mut ThreatProbabilities, sa: &SpellAbility, is_instant: bool) {
    if let Some(api) = sa.api {
        classify_effect(probs, api, sa, is_instant);
    }
    if let Some(sub) = &sa.sub_ability {
        classify_ability(probs, sub, is_instant);
    }
}

fn classify_effect(probs: &mut ThreatProbabilities, api: ApiType, sa: &SpellAbility, is_instant: bool) {
    match api {
        ApiType::Counter => probs.counterspell = 1.0,
        ApiType::DestroyAll | ApiType::DamageAll => probs.board_wipe = 1.0,
        ApiType::Destroy => probs.targeted_removal = 1.0,
        ApiType::DealDamage => {
            probs.targeted_removal = 1.0;
            if sa_can_target_player(sa) {          // replaces TargetFilter::Any
                probs.direct_damage = 1.0;
            }
        }
        ApiType::Pump if is_instant => probs.combat_trick = 1.0,
        ApiType::ChangeZone => {
            match sa.ir.destination_zone {
                Some(ZoneType::Exile) | Some(ZoneType::Graveyard) => probs.targeted_removal = 1.0,
                Some(ZoneType::Hand) => probs.targeted_removal = 1.0, // Phase's Effect::Bounce
                _ => {}
            }
        }
        _ => {}
    }
}

// Helper with NO Phase counterpart: derive "can hit a player" from target restrictions.
fn sa_can_target_player(sa: &SpellAbility) -> bool {
    // Inspect sa.target_restrictions / sa.ir.valid_tgts_text for "Player".
    // Forge "any target" => ValidTgts$ Creature,Planeswalker,Player (and battles).
    sa.ir
        .valid_tgts_text
        .as_deref()
        .map(|t| t.contains("Player"))
        .unwrap_or(false)
}

// ── Profile build (ADAPTED: deck iteration; verbatim probability calls) ──

pub fn build_threat_profile(
    state: &GameState,
    opponent: PlayerId,
    deck_view: &RemainingDeckView,
) -> ThreatProfile {
    let pool_size: u32 = deck_view.entries.iter().map(|e| e.count).sum();
    let hand_size = state.cards_in_zone(ZoneType::Hand, opponent).len() as u32;

    let mut pools = ThreatCategoryPools::default();
    for entry in &deck_view.entries {
        let c = classify_card_face(&entry.card);
        let mv = entry.card.mana_value().max(0) as u32;
        let count = entry.count;
        if c.counterspell > 0.0 { pools.counterspell.add(mv, count); }
        if c.targeted_removal > 0.0 { pools.targeted_removal.add(mv, count); }
        if c.board_wipe > 0.0 { pools.board_wipe.add(mv, count); }
        if c.combat_trick > 0.0 { pools.combat_trick.add(mv, count); }
        if c.direct_damage > 0.0 { pools.direct_damage.add(mv, count); }
    }

    let opponent_archetype = DeckProfile::analyze(&deck_view.entries).archetype;

    let probabilities = ThreatProbabilities {
        counterspell: hypergeometric_at_least_one(pool_size, pools.counterspell.count, hand_size),
        targeted_removal: hypergeometric_at_least_one(pool_size, pools.targeted_removal.count, hand_size),
        board_wipe: hypergeometric_at_least_one(pool_size, pools.board_wipe.count, hand_size),
        combat_trick: hypergeometric_at_least_one(pool_size, pools.combat_trick.count, hand_size),
        direct_damage: hypergeometric_at_least_one(pool_size, pools.direct_damage.count, hand_size),
    };

    ThreatProfile { probabilities, opponent_archetype, category_pools: pools, pool_size, hand_size }
}

pub fn castable_probabilities(
    profile: &ThreatProfile,
    state: &GameState,
    opponent: PlayerId,
) -> ThreatProbabilities {
    let opp_mana = available_mana(state, opponent); // u32 (sibling zone_eval port)
    ThreatProbabilities {
        counterspell: hypergeometric_at_least_one(profile.pool_size, profile.category_pools.counterspell.castable_count(opp_mana), profile.hand_size),
        targeted_removal: hypergeometric_at_least_one(profile.pool_size, profile.category_pools.targeted_removal.castable_count(opp_mana), profile.hand_size),
        board_wipe: hypergeometric_at_least_one(profile.pool_size, profile.category_pools.board_wipe.castable_count(opp_mana), profile.hand_size),
        combat_trick: hypergeometric_at_least_one(profile.pool_size, profile.category_pools.combat_trick.castable_count(opp_mana), profile.hand_size),
        direct_damage: hypergeometric_at_least_one(profile.pool_size, profile.category_pools.direct_damage.castable_count(opp_mana), profile.hand_size),
    }
}

pub fn build_threat_profile_multiplayer(
    state: &GameState,
    ai_player: PlayerId,
) -> Option<ThreatProfile> {
    let opponents = forge_engine::player::PlayerCollection::opponents_of(state, ai_player).0;
    if opponents.is_empty() {
        return None;
    }
    let primary = opponents.iter().copied().max_by_key(|&opp| {
        let mana = available_mana(state, opp);
        let hand = state.cards_in_zone(ZoneType::Hand, opp).len() as u32;
        (mana, hand)
    })?;
    let deck_view = remaining_deck_view(state, primary);
    if deck_view.entries.is_empty() {
        return None;
    }
    Some(build_threat_profile(state, primary, &deck_view))
}

// ── ArchetypeBaseProbabilities (VERBATIM constants — do not alter) ────

pub struct ArchetypeBaseProbabilities;

impl ArchetypeBaseProbabilities {
    pub fn for_archetype(archetype: DeckArchetype) -> ThreatProbabilities {
        match archetype {
            DeckArchetype::Aggro    => ThreatProbabilities { counterspell: 0.0, targeted_removal: 0.2, board_wipe: 0.0, combat_trick: 0.3,  direct_damage: 0.3 },
            DeckArchetype::Control  => ThreatProbabilities { counterspell: 0.3, targeted_removal: 0.3, board_wipe: 0.2, combat_trick: 0.0,  direct_damage: 0.1 },
            DeckArchetype::Midrange => ThreatProbabilities { counterspell: 0.1, targeted_removal: 0.3, board_wipe: 0.1, combat_trick: 0.15, direct_damage: 0.1 },
            DeckArchetype::Combo    => ThreatProbabilities { counterspell: 0.2, targeted_removal: 0.1, board_wipe: 0.1, combat_trick: 0.0,  direct_damage: 0.0 },
            DeckArchetype::Ramp     => ThreatProbabilities { counterspell: 0.0, targeted_removal: 0.2, board_wipe: 0.2, combat_trick: 0.0,  direct_damage: 0.1 },
        }
    }
}
```

**Verbatim-carry checklist (must match Phase bit-for-bit):**
- Hypergeometric guards/order: `pool==0||hand==0 → 0.0`; clamp `K=min(K,N)`; `K>=N → 1.0`;
  `hand>=N → 1.0`; product loop; `p_zero<=0.0 → 1.0`; final `(1.0-p_zero).clamp(0,1)`.
- `CategoryPool::add` first-card `min` init via `self.count == count` sentinel; bucket cap at 7.
- `castable_count` inclusive range `[..=limit]`, `limit = min(max_mana,7)`.
- All five archetype probability tuples (the only "weights" in the module).
- Multiplayer tie-break key `(mana, hand)` via `max_by_key`.

---

## 4. Dependencies on other phase-ai modules

This module does not stand alone. The forge-ai port must also provide (or stub) the siblings:

- **`deck_knowledge`** — `RemainingDeckView { entries: Vec<DeckEntry> }`,
  `DeckEntry { card: <classifiable card>, count: u32 }`, and
  `remaining_deck_view(state, player) -> RemainingDeckView`. Models the opponent's
  library+hand pool minus seen/removed cards. **Required for `build_threat_profile*`.** In
  manabrew the `card` field should be a `CardState`/`Card` (so `get_intrinsic_spell_abilities`
  + `mana_value` + `type_line` work), or a `forge_card_script::ParsedCardScript` (see §5).
- **`deck_profile`** — `enum DeckArchetype { Aggro, Control, Midrange, Combo, Ramp }` and
  `DeckProfile::analyze(&entries) -> DeckProfile { archetype: DeckArchetype }`. Used for
  `opponent_archetype` and the `ArchetypeBaseProbabilities` table.
- **`zone_eval`** — `available_mana(state, player) -> u32`. Used by `castable_probabilities`
  and the multiplayer opponent picker. Manabrew impl wraps
  `mana::calculate_available_mana(pool, game, player).total_mana()` (clamp to u32) or counts
  untapped mana sources.

No phase-ai module depends back on `threat_profile` within this file; downstream consumers
(evaluation/search modules) call `castable_probabilities` / `for_archetype`.

---

## 5. Risks — adaptation vs infeasibility

**Adaptation needed (feasible):**

1. **Typed `Effect` → `ApiType` + IR switch (core risk).** Phase pattern-matches a closed
   `Effect` enum; manabrew classifies on `ApiType` + `SpellAbilityIr`. The mapping in §2 is
   straightforward for `Counter`/`DestroyAll`/`DamageAll`/`Destroy`/`Pump`. Caveat: a card's
   primary `sa.api` plus its `sub_ability` chain must be walked exactly like Phase walks
   `ability.sub_ability` (manabrew `sub_ability` is the chained DB$ effect — same shape).
2. **`Effect::Bounce` has no verb.** Map to `ApiType::ChangeZone` with
   `ir.destination_zone == Hand`. Combined with the Exile/Graveyard arm, a single
   `ChangeZone` arm that reads `ir.destination_zone` covers Phase's `ChangeZone`+`Bounce`.
   Risk: `destination_zone` may be `None` for SVar/defined destinations → those won't classify
   (acceptable, matches Phase's "no match" fall-through for unparsed cases).
3. **`TargetFilter::Any` → target-restriction inspection.** Phase flags `direct_damage` only
   when `DealDamage` target is `Any`. Manabrew has no `Any` flag; derive from
   `sa.target_restrictions` / `ir.valid_tgts_text` containing `Player`. Imperfect: Forge
   encodes "any target" as `ValidTgts$ Creature,Planeswalker,Player` (sometimes
   `Battle`/`Player`), and X-damage or defined-target burn may not expose a parseable filter.
   Conservative fallback: treat damage whose target list includes `Player` (or is the keyword
   "any target") as `direct_damage`; otherwise only `targeted_removal`. Tune against real cards.
4. **`available_mana` precision.** Phase's `u32` from `zone_eval`; manabrew's
   `calculate_available_mana` returns a `ManaPool` needing `.total_mana()` and a `pool` arg.
   The `castable_count` gating compares against raw mana value only (ignores colored-pip
   requirements) — this is faithful to Phase (which also gates on mana value alone), so no
   extra fidelity needed, but note both are approximations vs true castability.

**Classification source decision (implementation choice, not a blocker):**
Classifying a deck pool is **static** (no game instance per card). Two manabrew routes:
- (a) Build a `Card`/`CardState` per distinct card and call `get_intrinsic_spell_abilities()`
  (card/card_state.rs:357) — richest (target restrictions, sub-ability chain). Heavier.
- (b) Pure parse via `forge_card_script::ParsedCardScript::parse(raw)` + `.abilities()` (api-ir
  §7), reading the first token (`SP$/AB$/DB$ <Verb>`) as the `ApiType` string and params via
  `ParsedParams`. Lighter, no engine, but coarser target-restriction access.
  Recommend (a) routed through the `deck_knowledge` port so the `card` field is already a
  built `CardState`; fall back to (b) only if deck_knowledge yields raw scripts.

**No infeasible parts.** Everything maps onto manabrew's API. The only true gaps
(`Effect`/`Bounce`/`TargetFilter::Any`) are representational, resolved by reading `ApiType`
+ `SpellAbilityIr` instead of a typed enum. The statistics, pools, and archetype constants
port 1:1.

**Tests:** Phase ships ~16 unit tests (hypergeometric values ~0.52 / ~0.62 / 0.1, classify
counter/wipe/burn/instant-pump-vs-sorcery-pump, castable gating, archetype bounds). Per repo
rule, do not add unit tests unless asked — but these values are the acceptance oracle for the
verbatim math and the classification mapping; verify against them manually.
