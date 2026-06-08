# Port spec — phase-ai eval helpers → forge-ai

Source: `github.com/phase-rs/phase` `crates/phase-ai/src/{card_advantage,mana_colors,zone_eval,tribute_eval}.rs`
Target engine: manabrew `forge-engine` (Forge-DSL). All engine paths below are relative to
`forge-engine/crates/forge-engine/src/` unless noted.

Cross-cutting type map (Phase `engine::…` → manabrew):

| Phase type / API | manabrew equivalent | cite |
|---|---|---|
| `GameState` (`engine::types::game_state`) | `GameState` (= `Game`) | `game.rs:92` |
| `PlayerId` `.0 as usize` | `PlayerId(u32)`, `.index()->usize` | `ids.rs:9,18` |
| `state.objects.get(&id) -> GameObject` | `game.card(CardId) -> &Card` | `game.rs:263` |
| `state.players[i].hand` (Vec) | `game.cards_in_zone(ZoneType::Hand, pid) -> &[CardId]` | `game.rs:520` |
| `state.players[i].graveyard` | `game.cards_in_zone(ZoneType::Graveyard, pid)` | `game.rs:520` |
| `state.battlefield` (global) | per-owner `cards_in_zone(ZoneType::Battlefield, pid)`; filter by `card.controller` | `game.rs:520` |
| `players::opponents(state, p) -> Vec<PlayerId>` | `PlayerCollection::opponents_of(game, p)` (iterable, `.0: Vec<PlayerId>`) | `player/player_collection.rs:36` |
| `obj.controller` | `card.controller: PlayerId` | `card/mod.rs:209` |
| `obj.is_token` | `card.is_token: bool` | `card/mod.rs:405` |
| `obj.tapped` | `card.tapped: bool` | `card/mod.rs:257` |
| `obj.card_types.core_types.contains(CoreType::Land)` | `card.is_land()` | `card/mod.rs:1026` |
| `obj.mana_cost.mana_value()` | `card.mana_cost.cmc() -> i32` | `forge-foundation/src/mana.rs:505` |
| `obj.keywords` / `Keyword` enum | `card.has_keyword_enum(Kw)` / `has_keyword(&str)` | `card/mod.rs:1269,1261` |
| `combat::has_summoning_sickness(obj)` | `card.summoning_sick: bool` (mind haste) | `card/mod.rs:288` |
| `obj.abilities` + `mana_abilities::is_mana_ability` | `card.activated_abilities[].is_mana_ability: bool` | `ability/activated.rs:21` |
| `state.players[i].mana_pool.total()` | **NOT on PlayerState** — `GameLoop.mana_pools[i].total_mana()` | `game_loop.rs:39`, `mana/mana_pool.rs:200` |
| `ManaType` (`engine::types::mana`) | no enum; `u16` ManaAtom bitmask | `forge-foundation/src/mana.rs:9` |
| `ManaProduction` (rich) | `ProducedMana` (coarse) | `ability/produced_mana.rs:11` |

---

## 1) card_advantage.rs

### What it does
Card-advantage differential heuristic. `differential(state, player)` =
`count_resources(player)` − `max over opponents of count_resources(opp)` (compares vs the
single best-resourced opponent; `0.0` if no opponents). `count_resources` =
`real_permanents*1.0 + tokens*0.5 + hand_size*1.0`, scanning the battlefield for permanents
**controlled** by the player, tokens at half weight, hand cards at full weight. Weights:
**real permanent 1.0, token 0.5, hand card 1.0**. Aggregator: `fold(NEG_INFINITY, f64::max)`.

### Engine APIs read → manabrew equiv
- `players::opponents` → `PlayerCollection::opponents_of(game, player)` `player_collection.rs:36`.
- `state.battlefield` global iteration filtered by `obj.controller == player` →
  manabrew zones are per-owner; iterate every owner's battlefield and filter by
  `card.controller`. `game.cards_in_zone(ZoneType::Battlefield, owner)` `game.rs:520`.
  (Do **not** just read `cards_in_zone(Battlefield, player)` — that is owner-keyed and would
  miss stolen permanents / include lost-control ones, breaking parity with Phase's
  controller semantics.)
- `obj.is_token` → `card.is_token` `card/mod.rs:405`.
- `state.players[p].hand.len()` → `game.cards_in_zone(ZoneType::Hand, player).len()` `game.rs:520`.

No missing APIs. Fully feasible.

### Skeleton (logic engine-agnostic; weights verbatim)
```rust
use forge_engine::game::GameState;
use forge_engine::ids::PlayerId;
use forge_foundation::zone::ZoneType;
use forge_engine::player::player_collection::PlayerCollection;

pub fn differential(state: &GameState, player: PlayerId) -> f64 {
    let my_resources = count_resources(state, player);
    let opponents = PlayerCollection::opponents_of(state, player);
    if opponents.0.is_empty() {
        return 0.0;
    }
    let max_opp = opponents
        .0
        .iter()
        .map(|&opp| count_resources(state, opp))
        .fold(f64::NEG_INFINITY, f64::max);
    my_resources - max_opp
}

fn count_resources(state: &GameState, player: PlayerId) -> f64 {
    let mut real_permanents = 0u32;
    let mut tokens = 0u32;
    for &owner in &state.player_order {
        for &cid in state.cards_in_zone(ZoneType::Battlefield, owner) {
            let c = state.card(cid);
            if c.controller == player {
                if c.is_token {
                    tokens += 1;
                } else {
                    real_permanents += 1;
                }
            }
        }
    }
    let hand = state.cards_in_zone(ZoneType::Hand, player).len() as f64;
    real_permanents as f64 + (tokens as f64 * 0.5) + hand
}
```
Approx ported size: ~40 LOC. Risk: low — only the global-vs-per-owner battlefield iteration
differs (handled above).

---

## 2) mana_colors.rs

### What it does
`land_produced_color_types(subtypes, abilities) -> Vec<ManaType>`: distinct **colored** mana a
land can produce, unioning (a) intrinsic mana from basic-land subtypes (typed dual
"Plains Island" → W,U with no printed effect) and (b) the colors of every **Activated**
`Effect::Mana` ability. Dedup, colorless excluded; `len() >= 2` marks a fixing land.
`collect_mana_production_colors` is exhaustive over `ManaProduction`: statically-known
producers (`Fixed`/`Mixed`/`AnyOneColor`/`AnyCombination`/`ChoiceAmongCombinations`) contribute
their enumerated colors; dynamic producers (`ChosenColor`/`OpponentLandColors`/commander-identity/
among-permanents/etc.) and `Colorless` contribute nothing. `push_color` dedups and drops
`ManaType::Colorless`.

### Engine APIs read → manabrew equiv
- `land_subtype_to_mana_type(&str)` (`engine::game::mana_payment`) → **no per-subtype string fn**;
  manabrew computes intrinsic land mana per-card: `land_mana_atoms(card) -> Vec<u16>` `mana/mod.rs:634`
  and `basic_land_mana_atom(card) -> Option<u16>` `mana/mod.rs:406`. These already union the
  basic-land-type intrinsics, collapsing Phase's part (a).
- `mana_color_to_type(color)` (`engine::game::mana_sources`) → `color_name_to_mana_atom(name) -> Option<u16>`
  `mana/mod.rs:533` or `mana_atom_from_produced(&str) -> Option<u16>` `mana/mod.rs:431`.
- `AbilityDefinition { kind: AbilityKind, effect: Effect::Mana { produced: ManaProduction } }`
  (`engine::types::ability`) → `card.activated_abilities: Vec<ActivatedAbility>` `card/mod.rs:350`;
  each has `is_mana_ability: bool` `ability/activated.rs:21` and `mana_part: Option<AbilityManaPart>`
  carrying `ProducedMana` (api-ir.md §5). Filter `is_mana_ability` instead of matching
  `kind==Activated && Effect::Mana`.
- `ManaType` enum → **NO equivalent**: manabrew has no `ManaType` enum; colors are `u16` ManaAtom
  bitmasks (`WHITE=1,BLUE=2,BLACK=4,RED=8,GREEN=16,COLORLESS=32,GENERIC=64`)
  `forge-foundation/src/mana.rs:9`. Port returns `Vec<u16>`; "colorless excluded" = drop
  `COLORLESS|GENERIC`.
- `ManaProduction` (10+ typed variants) → **PARTIAL** `ProducedMana { Any, Chosen, Combo(..),
  Special(String), Fixed(Vec<String>), Raw(String) }` `ability/produced_mana.rs:11` with helpers
  `is_any_like()` `:88`, `is_choice_like()` `:98`, `fixed_tokens() -> Vec<String>` `:118`.
  Mapping (semantic-loss flagged):
  - `Fixed`/`Mixed` → `ProducedMana::Fixed(tokens)` → map each via `mana_atom_from_produced`.
  - `ChoiceAmongCombinations`/`AnyCombination`/`AnyOneColor` (enumerated options) →
    `ProducedMana::Combo(..)` / `fixed_tokens()` — **manabrew loses the enumerated color list**
    for truly "any"-typed producers.
  - `Colorless` / dynamic (`ChosenColor`/`OpponentLandColors`/identity/among-permanents) →
    `ProducedMana::Any`/`Chosen`/`Special`/`Raw` → contribute nothing (mirror Phase's
    no-contribution arms). FLAG: manabrew cannot distinguish "any color, all five contribute"
    from "chosen later, nothing known" — both fold into `Any`. Faithful choice: treat
    `is_any_like()` as **no contribution** (matches Phase `ChosenColor`), accepting that a
    five-color "any" land scores 0 colored sources rather than 5.

### Parts pattern
Phase deliberately operates on `(subtypes, abilities)` so a `GameObject` view and a `CardFace`
view share one impl. manabrew exposes no unified subtypes+abilities "parts" view; the natural
unit is `&Card`. For static/DB-time evaluation use forge-card-script `ParsedCardScript`
(api-ir.md §7). Recommend a single `&Card` signature; a parts-style split is extra scaffolding
not justified unless a CardFace caller is actually needed.

### Skeleton
```rust
use forge_engine::card::Card;
use forge_engine::mana::{land_mana_atoms, mana_atom_from_produced};
use forge_foundation::mana::ManaAtom; // u16 consts

pub fn land_produced_color_atoms(card: &Card) -> Vec<u16> {
    let mut colors = Vec::new();
    for atom in land_mana_atoms(card) {           // (a) intrinsic basic-land-type mana
        push_color(&mut colors, atom);
    }
    for ab in &card.activated_abilities {          // (b) activated mana abilities
        if !ab.is_mana_ability { continue; }
        if let Some(part) = &ab.mana_part {
            collect_produced_mana_colors(&mut colors, &part.produced);
        }
    }
    colors
}

fn collect_produced_mana_colors(colors: &mut Vec<u16>, produced: &ProducedMana) {
    match produced {
        ProducedMana::Fixed(tokens) => {
            for t in tokens {
                if let Some(a) = mana_atom_from_produced(t) { push_color(colors, a); }
            }
        }
        ProducedMana::Combo(_) => {
            for t in produced.fixed_tokens() {
                if let Some(a) = mana_atom_from_produced(&t) { push_color(colors, a); }
            }
        }
        // Any/Chosen/Special/Raw → unknown-from-card → no contribution (mirror Phase dynamic arms)
        _ => {}
    }
}

fn push_color(colors: &mut Vec<u16>, atom: u16) {
    if atom != ManaAtom::COLORLESS && atom != ManaAtom::GENERIC && !colors.contains(&atom) {
        colors.push(atom);
    }
}
```
(Verify exact `ProducedMana` variant shapes against `ability/produced_mana.rs` before final;
`Combo` payload shape and `fixed_tokens()` coverage drive the multi-color arms.)
Approx ported size: ~45 LOC. Risk: medium — `ManaType`→`u16` substitution is mechanical;
the `ProducedMana` coarseness loses Phase's enumerated-options distinction for "any"-typed lands.

---

## 3) zone_eval.rs

### What it does
Archetype-tuned zone-quality differential. `zone_bonus(state, player, archetype)` =
`player_zone_score(player)` − `max over opponents` (returns own score if no opponents).
`player_zone_score` = `hand_quality + graveyard_value`.
- `hand_quality`: per hand card `base + (castable ? castable_bonus : 0)`, castable iff
  `mana_value <= available_mana`.
- `graveyard_value`: per graveyard card `base + (recursion_keyword ? recursion_bonus : 0)`;
  recursion = `Flashback | Escape | Unearth`.
- `available_mana`: count untapped controlled permanents that are lands OR
  (`!summoning_sick && has a mana ability`), plus `mana_pool.total()`. (CR 302.6: sick non-land
  dorks excluded.)

`ZoneWeights` per `DeckArchetype` — **carry verbatim**:
| archetype | hand_card_base | castable_bonus | graveyard_base | recursion_bonus |
|---|---|---|---|---|
| Aggro | 0.3 | 0.4 | 0.05 | 0.1 |
| Midrange | 0.4 | 0.3 | 0.10 | 0.2 |
| Control | 0.6 | 0.2 | 0.15 | 0.3 |
| Combo | 0.5 | 0.3 | 0.20 | 0.4 |
| Ramp | 0.4 | 0.3 | 0.10 | 0.2 |

### Engine APIs read → manabrew equiv
- `players::opponents` → `PlayerCollection::opponents_of` `player_collection.rs:36`.
- `state.players[p].hand` → `cards_in_zone(ZoneType::Hand, p)` `game.rs:520`.
- `state.players[p].graveyard` → `cards_in_zone(ZoneType::Graveyard, p)` `game.rs:520`.
- `obj.mana_cost.mana_value()` → `card.mana_cost.cmc()` `forge-foundation/src/mana.rs:505`.
- recursion keywords `Keyword::{Flashback,Escape,Unearth}` → `card.has_keyword_enum(Kw::Flashback)`
  / `Kw::Escape` / `Kw::Unearth`; enum variants confirmed `keyword/keyword_instance.rs:265,250,377`.
  (manabrew `Keyword` variants are unit-style; cost lives separately — match by variant, not payload.)
- `state.battlefield` + `obj.controller`/`tapped`/land/`abilities` → per-owner battlefield scan,
  `card.controller`, `card.tapped` `card/mod.rs:257`, `card.is_land()` `card/mod.rs:1026`,
  `card.activated_abilities[].is_mana_ability` `ability/activated.rs:21`.
- `combat::has_summoning_sickness(obj)` → `card.summoning_sick` `card/mod.rs:288`. FLAG: Phase's
  helper treats haste; faithful manabrew test is `summoning_sick && !card.has_haste()` to exclude
  (a hasty dork can tap for mana). Use `card.has_haste()` `card/mod.rs:1281`.
- `state.players[p].mana_pool.total()` → **NO equivalent on PlayerState**. Pools live on
  `GameLoop.mana_pools: Vec<ManaPool>` `game_loop.rs:39`; `ManaPool::total_mana() -> i32`
  (count of mana entries) `mana/mana_pool.rs:200`. **Signature must change**: `available_mana`
  and the public `zone_bonus` need `&[ManaPool]` (or the player's pool) threaded in, since
  `&GameState` alone cannot see the pool. ADAPTATION REQUIRED.
- `DeckArchetype` (`crate::deck_profile`) → **NO equivalent in manabrew engine**. This is a
  phase-ai module dependency (see §5). Must be ported/defined in forge-ai.

### Skeleton (weights/formulas verbatim)
```rust
use crate::deck_profile::DeckArchetype; // ported alongside (see deps)
use forge_engine::mana::mana_pool::ManaPool;

struct ZoneWeights { hand_card_base: f64, castable_bonus: f64, graveyard_base: f64, recursion_bonus: f64 }

impl ZoneWeights {
    fn for_archetype(a: DeckArchetype) -> Self {
        match a {
            DeckArchetype::Aggro    => Self { hand_card_base: 0.3, castable_bonus: 0.4, graveyard_base: 0.05, recursion_bonus: 0.1 },
            DeckArchetype::Midrange => Self { hand_card_base: 0.4, castable_bonus: 0.3, graveyard_base: 0.10, recursion_bonus: 0.2 },
            DeckArchetype::Control  => Self { hand_card_base: 0.6, castable_bonus: 0.2, graveyard_base: 0.15, recursion_bonus: 0.3 },
            DeckArchetype::Combo    => Self { hand_card_base: 0.5, castable_bonus: 0.3, graveyard_base: 0.20, recursion_bonus: 0.4 },
            DeckArchetype::Ramp     => Self { hand_card_base: 0.4, castable_bonus: 0.3, graveyard_base: 0.10, recursion_bonus: 0.2 },
        }
    }
}

pub fn zone_bonus(state: &GameState, pools: &[ManaPool], player: PlayerId, archetype: DeckArchetype) -> f64 {
    let w = ZoneWeights::for_archetype(archetype);
    let my = player_zone_score(state, pools, player, &w);
    let opps = PlayerCollection::opponents_of(state, player);
    if opps.0.is_empty() { return my; }
    let max_opp = opps.0.iter()
        .map(|&o| player_zone_score(state, pools, o, &w))
        .fold(f64::NEG_INFINITY, f64::max);
    my - max_opp
}

fn player_zone_score(state: &GameState, pools: &[ManaPool], p: PlayerId, w: &ZoneWeights) -> f64 {
    let avail = available_mana(state, pools, p);
    hand_quality(state, p, avail, w) + graveyard_value(state, p, w)
}

fn hand_quality(state: &GameState, p: PlayerId, available_mana: u32, w: &ZoneWeights) -> f64 {
    state.cards_in_zone(ZoneType::Hand, p).iter()
        .map(|&cid| {
            let c = state.card(cid);
            let castable = if c.mana_cost.cmc() as u32 <= available_mana { w.castable_bonus } else { 0.0 };
            w.hand_card_base + castable
        }).sum()
}

fn graveyard_value(state: &GameState, p: PlayerId, w: &ZoneWeights) -> f64 {
    state.cards_in_zone(ZoneType::Graveyard, p).iter()
        .map(|&cid| {
            let recursion = if has_recursion_keyword(state.card(cid)) { w.recursion_bonus } else { 0.0 };
            w.graveyard_base + recursion
        }).sum()
}

pub(crate) fn has_recursion_keyword(c: &Card) -> bool {
    c.has_keyword_enum(Kw::Flashback) || c.has_keyword_enum(Kw::Escape) || c.has_keyword_enum(Kw::Unearth)
}

pub(crate) fn available_mana(state: &GameState, pools: &[ManaPool], player: PlayerId) -> u32 {
    let mut sources = 0usize;
    for &owner in &state.player_order {
        for &cid in state.cards_in_zone(ZoneType::Battlefield, owner) {
            let c = state.card(cid);
            if c.controller == player && !c.tapped
                && (c.is_land()
                    || ((!c.summoning_sick || c.has_haste())
                        && c.activated_abilities.iter().any(|a| a.is_mana_ability)))
            {
                sources += 1;
            }
        }
    }
    let pool = pools[player.index()].total_mana() as usize;
    (sources + pool) as u32
}
```
Approx ported size: ~95 LOC. Risk: medium — `DeckArchetype` dep + `mana_pool` not on
GameState (signature threading). Logic otherwise 1:1.

---

## 4) tribute_eval.rs — HIGH RISK / largely INFEASIBLE as-is

### What it does
CR 702.104 Tribute pay/decline evaluator. `decide(state) -> Option<TributeDecision>` reads
`state.waiting_for == WaitingFor::TributeChoice { source_id, count, .. }`; returns `None`
otherwise. Computes `counter_harm = 2.0 * count` and `decline_harm` by walking the source's
`trigger_definitions`, keeping triggers gated on `TriggerCondition::TributeNotPaid` with
`TriggerMode::ChangesZone`, walking each effect chain (`execute` → `sub_ability`), scoring
payloads via `score_effect_harm`. **Pay iff `decline_harm > counter_harm`; Decline on ties.**
Effect-harm weights (carry verbatim):
- `DealDamage{Fixed value, target}` → `value` (×1.5 if `target` filter hits multiple players —
  shape-string contains "EachOpponent"/"EachPlayer").
- `DamageEachPlayer{Fixed}` → `value.max(0)`; `DamageAll{Fixed}` → `value.max(0)`.
- `Draw{Fixed value}` → `2.0*value`; non-fixed → `2.0`.
- `DiscardCard{count}` → `1.5*count`.
- `GenericEffect` → `3.0`; `Pump` → `2.0`; everything else → `1.5`.

### Engine APIs read → manabrew equiv
- `WaitingFor::TributeChoice` (`engine::types::game_state::WaitingFor`) → **NO EQUIVALENT.**
  manabrew has no `WaitingFor` state-machine field and no Tribute prompt. The agent surface is
  callback-based (`PlayerAgent`, api-sim.md §3); a pay/decline choice would arrive through a
  callback like `choose_binary`/`confirm_action` (`agent/mod.rs:564,525`), not a polled
  `state.waiting_for`. **No `WaitingFor::TributeChoice` exists.**
- Tribute keyword / mechanic → **NOT IMPLEMENTED.** Grep of `forge-engine` + `forge-foundation`
  + `forge-card-script` finds zero "Tribute" references. No Tribute keyword variant in
  `keyword/keyword_instance.rs`, no Tribute handling anywhere.
- `TriggerCondition::TributeNotPaid` → **NO EQUIVALENT.** manabrew triggers are Forge-DSL:
  a `Trigger` carries an `ApiType`-driven `SpellAbility` (api-ir.md). There is no typed
  `TriggerCondition` enum with a `TributeNotPaid` variant; the "tribute wasn't paid" gate would
  be a DSL condition string, not a typed enum the AI can match on.
- `source.trigger_definitions.iter_unchecked()` / `TriggerMode::ChangesZone` → manabrew
  `card.triggers: Vec<Trigger>` `card/mod.rs:389`; trigger mode is the Forge `Mode$` (e.g.
  `ChangesZone`) parsed onto the trigger, not a typed `TriggerMode` enum surfaced like Phase.
- `Effect::{DealDamage,DamageEachPlayer,DamageAll,Draw,DiscardCard,GenericEffect,Pump}` +
  `QuantityExpr::Fixed{value}` → manabrew classifies via `ApiType` + `SpellAbilityIr`
  (api-ir.md §1–§4): `DealDamage→ApiType::DealDamage` + `EffectIr::DealDamage(DealDamageIr)`;
  `DamageEachPlayer/DamageAll→ApiType::EachDamage`/`DamageAll` + `EffectIr::DamageAll`;
  `Draw→ApiType::Draw` + `EffectIr::Draw`; `DiscardCard→ApiType::Discard`;
  `Pump→ApiType::Pump`; `GenericEffect→` no clean equivalent (Forge has no `GenericEffect`
  catch-all — it is the `_ => 1.5` default). `QuantityExpr::Fixed{value}` → `EffectIr` amount
  via `AmountExpr::Literal(i32)` (`parsing/amount.rs`) or `ir.*_text`. The payload-scoring half
  is portable onto the ApiType/EffectIr classifier.
- `target_hits_multiple_players(filter)` via `format!("{filter:?}")` substring match → manabrew
  `ir.valid_tgts_text` / `defined_player` (api-ir.md §3) string inspection; Forge's
  "each opponent" surfaces as `Defined$ Opponent` / `ValidTgts$ ... Player`.

### Verdict
The **scoring heuristic** (counter_harm, effect-payload weights) is portable onto the
ApiType/EffectIr classifier. The **entry point and gating are infeasible without first
building the Tribute mechanic**: no Tribute keyword, no pay/decline prompt, no
`TributeNotPaid` trigger condition. A faithful port requires, in order:
1. Implement Tribute in the engine (keyword + ETB pay/decline choice + "tribute wasn't paid"
   trigger condition) — large, out of scope for an AI-only port.
2. Route the decision through a `PlayerAgent` callback (`choose_binary`/`confirm_action`),
   not a polled `WaitingFor`.
3. Then port `decide` as a pure scorer taking `(source: &Card, count: u32)` and walking
   `card.triggers` filtered by the (new) tribute-not-paid DSL condition.

### Skeleton (scorer only — entry point stubbed pending engine support)
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TributeDecision { Pay, Decline }
impl TributeDecision { pub fn accept(self) -> bool { matches!(self, TributeDecision::Pay) } }

// Callable once the engine exposes (source, count) via a PlayerAgent callback.
pub fn decide_for(state: &GameState, source: CardId, count: u32) -> TributeDecision {
    let counter_harm = 2.0 * count as f64;                       // verbatim
    let decline_harm = estimate_decline_trigger_harm(state, source);
    if decline_harm > counter_harm { TributeDecision::Pay } else { TributeDecision::Decline }
}

fn estimate_decline_trigger_harm(state: &GameState, source: CardId) -> f64 {
    let c = state.card(source);
    let mut harm = 0.0;
    for trig in &c.triggers {
        // GATE: only triggers whose Mode$ is ChangesZone AND whose condition is
        // "tribute wasn't paid". NO typed TributeNotPaid in manabrew — needs the
        // engine's tribute DSL condition first; until then this filter cannot be written.
        if !trigger_is_tribute_not_paid_changeszone(trig) { continue; }
        let mut cur = trig.spell_ability();              // SpellAbility chain
        while let Some(sa) = cur {
            if let Some(api) = sa.api { harm += score_effect_harm(api, &sa.ir); }
            cur = sa.sub_ability.as_deref();
        }
    }
    harm
}

// Verbatim weights, re-expressed over ApiType + SpellAbilityIr / EffectIr:
fn score_effect_harm(api: ApiType, ir: &SpellAbilityIr) -> f64 {
    match api {
        ApiType::DealDamage => {
            let base = ir_damage_amount(ir).unwrap_or(0) as f64;
            if hits_multiple_players(ir) { base * 1.5 } else { base }
        }
        ApiType::EachDamage | ApiType::DamageAll => ir_damage_amount(ir).unwrap_or(0).max(0) as f64,
        ApiType::Draw => 2.0 * ir_count(ir).unwrap_or(1) as f64,
        ApiType::Discard => 1.5 * ir_count(ir).unwrap_or(1) as f64,
        ApiType::Pump => 2.0,
        // No GenericEffect verb in Forge; folds into the 1.5 default below.
        _ => 1.5,
    }
}
// hits_multiple_players: inspect ir.valid_tgts_text / ir.defined_player for
// "Opponent"/"EachOpponent"/"Player" (Phase used Debug-string substring match).
```
Approx ported size: ~70 LOC if the Tribute mechanic existed; **infeasible to wire today**.
Risk: HIGH — depends on an unimplemented engine mechanic.

---

## 5) Dependencies on other phase-ai modules
- `card_advantage.rs`: none.
- `mana_colors.rs`: it is itself a shared building block; Phase callers are
  `draft_eval::produced_color_count` and `policies::mulligan::keepables_by_land_count` (out of
  scope here). No upstream phase-ai dep.
- `zone_eval.rs`: **`crate::deck_profile::DeckArchetype`** — must port/define `deck_profile`
  (the `DeckArchetype { Aggro, Midrange, Control, Combo, Ramp }` enum at minimum) in forge-ai
  first. manabrew engine has no archetype concept.
- `tribute_eval.rs`: no phase-ai module dep, but a hard **engine** dep on an unimplemented
  Tribute mechanic + `WaitingFor`/`TriggerCondition` infrastructure.

## 6) Risk summary
- LOW: card_advantage (per-owner battlefield iteration is the only adaptation).
- MEDIUM: mana_colors (`ManaType`→`u16` atoms; `ProducedMana` coarser than `ManaProduction`,
  loses enumerated "any"-color options); zone_eval (port `DeckArchetype`; thread
  `&[ManaPool]` because pools are GameLoop-side, not on PlayerState; haste-aware sickness test).
- HIGH / INFEASIBLE: tribute_eval — Tribute keyword, ETB pay/decline prompt, and
  `TriggerCondition::TributeNotPaid` do not exist in manabrew; only the numeric scoring
  heuristic is portable, and only after the mechanic + an agent callback are built.
