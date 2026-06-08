# Port spec — `phase-ai/src/eval.rs` → `forge-ai/src/eval.rs`

Faithful-port spec for the Phase board-evaluation module. Source fetched verbatim
from `https://raw.githubusercontent.com/phase-rs/phase/main/crates/phase-ai/src/eval.rs`.
All weights/formulas/thresholds below are carried over **verbatim**; only the
engine-access calls change. Engine paths are relative to
`forge-engine/crates/forge-engine/src/`.

---

## 1. What this module does (the AI logic)

A pure, side-effect-free **static board evaluator**. Given a `GameState` and the
player to score for, it returns an `f64` "how good is this position for me"
number. It is the leaf-evaluation function for the planner/search layer.

Pieces:

1. **`EvalWeights`** — 9 scalar multipliers (life, aggression, board_presence,
   board_power, board_toughness, hand_size, zone_quality, card_advantage,
   synergy). `Default` = hand-tuned; `learned()` = 17Lands-trained late-phase
   weights.
2. **`EvalWeightSet`** — three `EvalWeights` (early / mid / late) plus
   `for_turn(turn)` selecting `0..=3 → early`, `4..=7 → mid`, `_ → late`.
   `learned()` carries the trained per-phase numbers.
3. **`KeywordBonuses`** — combat-keyword bonus table (multiplicative + flat) and
   a tapped penalty.
4. **`StrategicIntent`** + `strategic_intent()` — classifies the position into
   `PushLethal` / `Stabilize` / `PreserveAdvantage` / `Develop`.
5. **`board_stats()`** — `(creatures, total_power, total_toughness, non_creature_non_land_permanents)`
   for one player.
6. **`threat_level()` / `threat_level_projected()`** — a 0..~1 threat score per
   opponent combining board (0.4), life ratio (0.2), hand (0.15), commander-damage
   progress (0.25).
7. **`evaluate_state_breakdown()`** — the core. Terminal short-circuits (±10000),
   then a per-dimension differential vs opponents. **Two branches:** 2-player /
   single-opp uses plain averages; **3+ opponents** threat-weights the opponent
   aggregate.
8. **`creature_combat_value()` / `evaluate_creature*()`** — single-creature combat
   worth: `power*1.5 + toughness + keyword bonuses`, minus tapped penalty.
9. Thin wrappers: `evaluate_state()` (folds breakdown → total), `evaluate_for_planner()`
   (returns `ValueEstimate { value, intent }`).

---

## 2. Phase engine types/APIs read → manabrew equivalents

| Phase symbol (in eval.rs) | manabrew equivalent | cite | notes |
|---|---|---|---|
| `engine::types::game_state::GameState` | `forge_engine::game::GameState` | game.rs:92 | direct |
| `state.players[player.0 as usize]` (index) | `game.player(player) -> &PlayerState` | game.rs:271 | replace raw index; `.0 as usize` → `pid.index()` if a raw index is needed |
| `engine::types::player::PlayerId` | `PlayerId(pub u32)`, `.index()` | ids.rs:9,18 | direct |
| `engine::types::identifiers::ObjectId` | `CardId(pub u32)`, `.index()` | ids.rs:5,12 | Phase ObjectId == manabrew CardId |
| `state.objects.get(&obj_id) -> Option<&Object>` | `game.card(CardId) -> &Card` | game.rs:263 | manabrew `card()` is infallible (panics if absent). Since we only iterate ids returned by `cards_in_zone`, the ids are always valid — drop the `Option` match. |
| `state.battlefield` (global Vec<ObjectId>) | **NO global battlefield.** Use `game.cards_in_zone(ZoneType::Battlefield, pid)` per player, or loop `game.player_order` × that. | game.rs:520; player_order game.rs:117 | **Adapt (structural).** Phase scans one global list filtered by `obj.controller`; manabrew is per-player zone-keyed. Since every consumer already filters by a known player, just scan that player's battlefield zone directly — simpler and faster. |
| `obj.controller` | `Card.controller: PlayerId` | mod.rs:209 | direct (only needed if scanning globally; unnecessary with per-player zone scan) |
| `obj.card_types.core_types.contains(&CoreType::Creature)` | `Card::is_creature() -> bool` | mod.rs:1022 | prefer accessor (also handles bestow) |
| `... contains(&CoreType::Land)` | `Card::is_land() -> bool` | mod.rs:1026 | direct |
| `engine::types::card_type::CoreType` | `forge_foundation::card_type::CoreType` | card_type.rs (foundation) | only needed if not using `is_creature/is_land` |
| `obj.power: Option<i32>` (`.unwrap_or(0)`) | `Card.base_power: Option<i32>` **or** `Card::power() -> i32` | base mod.rs:231; layered mod.rs:988 | **Decision point.** Phase reads the *raw printed* power (`Option`). manabrew `power()` returns the **layered/effective** value (statics+counters) as a plain `i32`. Faithful-literal port → use `base_power.unwrap_or(0)`. Recommended (strictly better, engine-idiomatic) → use `power()`. Pick one consistently; see Risks. |
| `obj.toughness: Option<i32>` | `Card.base_toughness` / `Card::toughness()` | base mod.rs:232; layered mod.rs:1000 | same decision as power |
| `obj.has_keyword(&Keyword)` | `Card::has_keyword_enum(Keyword) -> bool` | mod.rs:1269 | respects grants/pumps |
| `engine::types::keywords::Keyword` variants `Flying, Trample, Deathtouch, Lifelink, Hexproof, Indestructible, FirstStrike, DoubleStrike, Vigilance, Menace` | `forge_engine::keyword::keyword_instance::Keyword` — **all 10 variants exist with identical names** | keyword_instance.rs:226,238,262,266,279,285,294,301,369,380 | direct 1:1. (Convenience bools `has_flying`/`has_trample`/… also exist mod.rs:1281-1313 but `has_hexproof/has_indestructible/has_menace` do **not**, so use `has_keyword_enum`.) |
| `obj.tapped: bool` | `Card.tapped: bool` | mod.rs:257 | direct |
| `obj.is_commander: bool` | `Card.is_commander: bool` | mod.rs:397 | direct |
| `obj.owner` | `Card.owner: PlayerId` | mod.rs:208 | direct |
| `o.hand: Vec<_>` → `o.hand.len()` | `game.cards_in_zone(ZoneType::Hand, pid).len()` | game.rs:520 | **Adapt.** No `PlayerState.hand` field; hand is a zone. |
| `p.life: i32` | `PlayerState.life: i32` | state.rs:16 | direct |
| `p.energy` | `PlayerState.energy_counters: i32` | state.rs:62 | direct (renamed) |
| `players::opponents(state, player) -> Vec<PlayerId>` | `PlayerCollection::opponents_of(game, player) -> PlayerCollection(Vec<PlayerId>)` | player_collection.rs:36 | iterate `.0`; semantics match (team-aware via `is_opponent_of`) |
| `state.waiting_for == WaitingFor::GameOver { winner: Option<PlayerId> }` | `game.game_over: bool` + `game.winner: Option<PlayerId>` | game.rs:120,121 | **Adapt.** No `WaitingFor` enum. Map: `if game.game_over { match game.winner { Some(w)==player→WIN, Some→LOSS, None→0.0 } }`. |
| `state.format_config.starting_life: i32` | `PlayerState.starting_life: i32` (per-player) | state.rs:17 | **Adapt.** No format-level config. Use the *target* player's `starting_life` for the life-ratio denominator (Phase's value is format-global; per-player is equivalent in normal formats). |
| `state.format_config.commander_damage_threshold: Option<u32>` | **NO field.** Derive from `PlayerState.commander_damage_enabled: bool` → `Some(21)` else `None`. | state.rs:53 | **Adapt.** MTG fixed threshold = 21. |
| `obj.is_commander && obj.owner == target` over `state.objects.values()` | iterate `PlayerState.commanders: Vec<CardId>` for the target | state.rs:51 (commanders); also `game.cards_in_zone(ZoneType::Command, pid)` game.rs:520 | better: use `commanders` list directly instead of scanning all objects |
| `engine::game::commander::commander_lethal_headroom(state, evaluator, cmd_id) -> Option<u32>` | **NO equivalent helper.** Compute inline from `PlayerState.commander_damage_received: HashMap<u32,i32>` (keyed by source commander id as u32). headroom = `threshold - received` clamped ≥0. | state.rs:50 | **FLAG — must build.** See §3 helper `commander_lethal_headroom`. |
| `crate::planner::ValueEstimate` | other phase-ai module (planner.rs) | — | dep, see §4 |
| `crate::projection::Projection` | other phase-ai module (projection.rs) | — | dep, see §4 |

**No-equivalent items (must be written / adapted), summary:**
- `WaitingFor::GameOver` → reconstruct from `game.game_over`/`game.winner`.
- `state.format_config.{starting_life, commander_damage_threshold}` → per-player
  `starting_life` + constant 21 gated on `commander_damage_enabled`.
- `commander::commander_lethal_headroom` → write inline helper from
  `commander_damage_received`.
- Global `state.battlefield`/`state.objects` model → per-player zone scans.

Everything else is a direct or trivially-renamed mapping.

---

## 3. Faithful-port plan — Rust skeleton

Weights, formulas, thresholds are **verbatim**. Only data access is adapted.
Module path: `forge-ai/src/eval.rs` (new `forge-ai` crate, or `ai/eval.rs` in
`forge-engine` — match the crate the rest of the port lands in).

```rust
use std::collections::HashMap;

use forge_engine::game::GameState;
use forge_engine::ids::{CardId, PlayerId};
use forge_engine::keyword::keyword_instance::Keyword;
use forge_engine::player::player_collection::PlayerCollection;
use forge_foundation::zone::ZoneType;
use serde::{Deserialize, Serialize};

use crate::planner::ValueEstimate;       // dep, see §4
use crate::projection::Projection;        // dep, see §4

const WIN_SCORE: f64 = 10000.0;
const LOSS_SCORE: f64 = -10000.0;

/// MTG fixed commander-damage lethal threshold. Phase pulled this from
/// format_config; manabrew has no format config so it is a constant gated by
/// PlayerState.commander_damage_enabled.
const COMMANDER_DAMAGE_THRESHOLD: u32 = 21;

// ─────────────────────────── EvalWeights ───────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalWeights {
    pub life: f64,
    pub aggression: f64,
    pub board_presence: f64,
    pub board_power: f64,
    pub board_toughness: f64,
    pub hand_size: f64,
    pub zone_quality: f64,
    pub card_advantage: f64,
    pub synergy: f64,
}

impl Default for EvalWeights {
    fn default() -> Self {
        EvalWeights {
            life: 1.0,
            aggression: 0.5,
            board_presence: 2.0,
            board_power: 1.5,
            board_toughness: 1.0,
            hand_size: 0.5,
            zone_quality: 0.3,
            card_advantage: 0.3,
            synergy: 0.5,
        }
    }
}

impl EvalWeights {
    pub fn learned() -> Self {
        EvalWeightSet::learned().late
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalWeightSet {
    pub early: EvalWeights,
    pub mid: EvalWeights,
    pub late: EvalWeights,
}

impl Default for EvalWeightSet {
    fn default() -> Self {
        Self::uniform(EvalWeights::default())
    }
}

impl EvalWeightSet {
    pub fn uniform(weights: EvalWeights) -> Self {
        EvalWeightSet { early: weights.clone(), mid: weights.clone(), late: weights }
    }

    pub fn for_turn(&self, turn: u32) -> &EvalWeights {
        match turn {
            0..=3 => &self.early,
            4..=7 => &self.mid,
            _ => &self.late,
        }
    }

    pub fn learned() -> Self {
        EvalWeightSet {
            early: EvalWeights {
                life: 0.4636, aggression: 0.5, board_presence: 2.0636,
                board_power: 1.0174, board_toughness: 1.0, hand_size: 1.3716,
                zone_quality: 0.3, card_advantage: 2.5, synergy: 0.5,
            },
            mid: EvalWeights {
                life: 0.5838, aggression: 0.5, board_presence: 1.9888,
                board_power: 0.8031, board_toughness: 1.0, hand_size: 2.396,
                zone_quality: 0.3, card_advantage: 2.5, synergy: 0.5,
            },
            late: EvalWeights {
                life: 0.4912, aggression: 0.5, board_presence: 1.7317,
                board_power: 0.6686, board_toughness: 1.0, hand_size: 2.5,
                zone_quality: 0.3, card_advantage: 1.945, synergy: 0.5,
            },
        }
    }
}

// ─────────────────────────── KeywordBonuses ───────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeywordBonuses {
    pub flying_mult: f64,
    pub trample_mult: f64,
    pub deathtouch_flat: f64,
    pub lifelink_mult: f64,
    pub hexproof_flat: f64,
    pub indestructible_flat: f64,
    pub first_strike_mult: f64,
    pub vigilance_flat: f64,
    pub menace_mult: f64,
    pub tapped_penalty: f64,
}

impl Default for KeywordBonuses {
    fn default() -> Self {
        Self {
            flying_mult: 1.0,
            trample_mult: 0.5,
            deathtouch_flat: 3.0,
            lifelink_mult: 0.5,
            hexproof_flat: 2.0,
            indestructible_flat: 4.0,
            first_strike_mult: 0.8,
            vigilance_flat: 1.0,
            menace_mult: 0.5,
            tapped_penalty: 1.5,
        }
    }
}

// ─────────────────────────── EvaluationBreakdown ───────────────────────────

#[derive(Debug, Clone, Default, PartialEq)]
pub struct EvaluationBreakdown {
    pub life: f64,
    pub board_presence: f64,
    pub board_power: f64,
    pub board_toughness: f64,
    pub hand_size: f64,
    pub aggression: f64,
    pub card_advantage: f64,
}

impl EvaluationBreakdown {
    pub fn total(&self) -> f64 {
        self.life
            + self.board_presence
            + self.board_power
            + self.board_toughness
            + self.hand_size
            + self.aggression
            + self.card_advantage
    }
}

// ─────────────────────────── StrategicIntent ───────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StrategicIntent {
    PushLethal,
    Stabilize,
    PreserveAdvantage,
    Develop,
}

pub fn strategic_intent(game: &GameState, player: PlayerId) -> StrategicIntent {
    let opponents = PlayerCollection::opponents_of(game, player).0;
    if opponents.is_empty() {
        return StrategicIntent::PreserveAdvantage;
    }

    let (_, my_power, _, _) = board_stats(game, player);
    let total_opp_power: i32 = opponents.iter().map(|&opp| board_stats(game, opp).1).sum();
    let min_opp_life = opponents
        .iter()
        .map(|&opp| game.player(opp).life)
        .min()
        .unwrap_or(i32::MAX);
    let my_life = game.player(player).life;
    let avg_opp_life = opponents
        .iter()
        .map(|&opp| game.player(opp).life)
        .sum::<i32>() as f64
        / opponents.len() as f64;

    if min_opp_life > 0 && my_power >= min_opp_life {
        StrategicIntent::PushLethal
    } else if my_life <= total_opp_power.max(1) {
        StrategicIntent::Stabilize
    } else if my_power >= total_opp_power && my_life as f64 >= avg_opp_life {
        StrategicIntent::PreserveAdvantage
    } else {
        StrategicIntent::Develop
    }
}

// ─────────────────────────── board_stats ───────────────────────────
// Phase iterated a global `state.battlefield` filtered by controller; manabrew
// is per-player zone-keyed, so scan the player's battlefield zone directly.

pub fn board_stats(game: &GameState, player: PlayerId) -> (i32, i32, i32, i32) {
    let mut creatures = 0;
    let mut total_power = 0;
    let mut total_toughness = 0;
    let mut non_creatures = 0;

    for &cid in game.cards_in_zone(ZoneType::Battlefield, player) {
        let c = game.card(cid);
        if c.is_creature() {
            creatures += 1;
            total_power += c.base_power.unwrap_or(0);      // see Risk R1 (raw vs layered)
            total_toughness += c.base_toughness.unwrap_or(0);
        } else if !c.is_land() {
            non_creatures += 1;
        }
    }

    (creatures, total_power, total_toughness, non_creatures)
}

fn projected_power(game: &GameState, player: PlayerId) -> i32 {
    game.cards_in_zone(ZoneType::Battlefield, player)
        .iter()
        .map(|&cid| game.card(cid))
        .filter(|c| c.is_creature())
        .map(|c| c.base_power.unwrap_or(0))
        .sum()
}

// ─────────────────────────── threat ───────────────────────────

pub fn threat_level(game: &GameState, evaluator: PlayerId, target: PlayerId) -> f64 {
    threat_level_projected(game, evaluator, target, None)
}

pub fn threat_level_projected(
    game: &GameState,
    evaluator: PlayerId,
    target: PlayerId,
    projection: Option<&Projection>,
) -> f64 {
    let target_player = game.player(target);
    // Phase: state.format_config.starting_life.max(1). manabrew: per-player.
    let starting_life = target_player.starting_life.max(1) as f64;

    let (creatures, base_power, _toughness, _nc) = board_stats(game, target);
    let power = projection
        .map(|p| projected_power(&p.state, target))
        .unwrap_or(base_power);
    let board_score = (creatures as f64 * 0.3 + power as f64 * 0.7).min(10.0) / 10.0;

    let life_ratio = (target_player.life as f64 / starting_life).clamp(0.0, 2.0) / 2.0;

    let hand_len = game.cards_in_zone(ZoneType::Hand, target).len();
    let hand_score = (hand_len as f64).min(7.0) / 7.0;

    // Phase: format_config.commander_damage_threshold: Option<u32>.
    // manabrew: constant 21, gated by commander_damage_enabled.
    let threshold: Option<u32> = if target_player.commander_damage_enabled {
        Some(COMMANDER_DAMAGE_THRESHOLD)
    } else {
        None
    };

    let cmd_threat = threshold.map_or(0.0, |threshold| {
        let threshold_f = f64::from(threshold);
        target_player
            .commanders
            .iter()
            .filter_map(|&cmd_id| {
                let headroom =
                    commander_lethal_headroom(game, evaluator, target, cmd_id)?;
                let dealt =
                    f64::from(u32::from(threshold).saturating_sub(headroom));
                Some((dealt / threshold_f).min(1.0))
            })
            .fold(0.0f64, f64::max)
    });

    board_score * 0.4 + life_ratio * 0.2 + hand_score * 0.15 + cmd_threat * 0.25
}

/// Port of engine::game::commander::commander_lethal_headroom — NO manabrew
/// equivalent. Returns commander-damage points still needed for `cmd` (owned by
/// `target`) to lethal `evaluator`, i.e. threshold − damage already dealt.
/// `None` if commander damage is not tracked for the evaluator.
fn commander_lethal_headroom(
    game: &GameState,
    evaluator: PlayerId,
    _target: PlayerId,
    cmd: CardId,
) -> Option<u32> {
    let eval_player = game.player(evaluator);
    if !eval_player.commander_damage_enabled {
        return None;
    }
    let dealt = eval_player
        .commander_damage_received
        .get(&cmd.0)
        .copied()
        .unwrap_or(0)
        .max(0) as u32;
    Some(COMMANDER_DAMAGE_THRESHOLD.saturating_sub(dealt))
}

// ─────────────────────────── creature value ───────────────────────────

pub fn evaluate_creature(game: &GameState, cid: CardId) -> f64 {
    evaluate_creature_with_bonuses(game, cid, &KeywordBonuses::default())
}

pub fn evaluate_creature_with_bonuses(
    game: &GameState,
    cid: CardId,
    bonuses: &KeywordBonuses,
) -> f64 {
    let c = game.card(cid);   // Phase guarded with Option; manabrew card() is infallible
    let mut value = creature_combat_value(
        c.base_power.unwrap_or(0),
        c.base_toughness.unwrap_or(0),
        |kw| c.has_keyword_enum(*kw),
        bonuses,
    );
    if c.tapped {
        value -= bonuses.tapped_penalty;
    }
    value
}

pub fn creature_combat_value(
    power: i32,
    toughness: i32,
    has_keyword: impl Fn(&Keyword) -> bool,
    bonuses: &KeywordBonuses,
) -> f64 {
    let power = power as f64;
    let toughness = toughness as f64;

    let mut value = power * 1.5 + toughness;

    if has_keyword(&Keyword::Flying) {
        value += power * bonuses.flying_mult;
    }
    if has_keyword(&Keyword::Trample) {
        value += power * bonuses.trample_mult;
    }
    if has_keyword(&Keyword::Deathtouch) {
        value += bonuses.deathtouch_flat;
    }
    if has_keyword(&Keyword::Lifelink) {
        value += power * bonuses.lifelink_mult;
    }
    if has_keyword(&Keyword::Hexproof) {
        value += bonuses.hexproof_flat;
    }
    if has_keyword(&Keyword::Indestructible) {
        value += bonuses.indestructible_flat;
    }
    if has_keyword(&Keyword::FirstStrike) || has_keyword(&Keyword::DoubleStrike) {
        value += power * bonuses.first_strike_mult;
    }
    if has_keyword(&Keyword::Vigilance) {
        value += bonuses.vigilance_flat;
    }
    if has_keyword(&Keyword::Menace) {
        value += power * bonuses.menace_mult;
    }

    value
}

// ─────────────────────────── top-level evaluate ───────────────────────────

pub fn evaluate_state(game: &GameState, player: PlayerId, weights: &EvalWeights) -> f64 {
    evaluate_state_breakdown(game, player, weights)
        .map(|breakdown| breakdown.total())
        .unwrap_or_else(|terminal| terminal)
}

pub fn evaluate_for_planner(
    game: &GameState,
    player: PlayerId,
    weights: &EvalWeights,
) -> ValueEstimate {
    let value = evaluate_state(game, player, weights);
    ValueEstimate {
        value,
        intent: strategic_intent(game, player),
    }
}

pub fn evaluate_state_breakdown(
    game: &GameState,
    player: PlayerId,
    weights: &EvalWeights,
) -> Result<EvaluationBreakdown, f64> {
    // Phase: WaitingFor::GameOver { winner }. manabrew: game_over + winner.
    if game.game_over {
        return Err(match game.winner {
            Some(w) if w == player => WIN_SCORE,
            Some(_) => LOSS_SCORE,
            None => 0.0,
        });
    }

    let opponents = PlayerCollection::opponents_of(game, player).0;
    let p = game.player(player);

    if p.life <= 0 {
        return Err(LOSS_SCORE);
    }
    let all_opponents_dead = !opponents.is_empty()
        && opponents.iter().all(|&opp| game.player(opp).life <= 0);
    if all_opponents_dead {
        return Err(WIN_SCORE);
    }

    let mut breakdown = EvaluationBreakdown::default();
    let opp_count = opponents.len().max(1) as f64;

    if opponents.len() >= 2 {
        let threats: Vec<(PlayerId, f64)> = opponents
            .iter()
            .map(|&opp| (opp, threat_level(game, player, opp)))
            .collect();
        let total_threat: f64 = threats.iter().map(|(_, t)| t).sum::<f64>().max(0.01);

        let mut weighted_opp_life = 0.0;
        let mut weighted_opp_creatures = 0.0;
        let mut weighted_opp_power = 0.0;
        let mut weighted_opp_toughness = 0.0;
        let mut weighted_opp_hand = 0.0;
        let mut weighted_opp_nc = 0.0;

        for &(opp, threat) in &threats {
            let w = threat / total_threat;
            let o = game.player(opp);
            let (opp_creatures, opp_power, opp_toughness, opp_nc) = board_stats(game, opp);
            let opp_hand = game.cards_in_zone(ZoneType::Hand, opp).len();
            weighted_opp_life += o.life as f64 * w;
            weighted_opp_creatures += opp_creatures as f64 * w;
            weighted_opp_power += opp_power as f64 * w;
            weighted_opp_toughness += opp_toughness as f64 * w;
            weighted_opp_hand += opp_hand as f64 * w;
            weighted_opp_nc += opp_nc as f64 * w;
        }

        breakdown.life = (p.life as f64 - weighted_opp_life) * weights.life;

        let (my_creatures, my_power, my_toughness, my_nc) = board_stats(game, player);
        breakdown.board_presence =
            (my_creatures as f64 - weighted_opp_creatures) * weights.board_presence;
        breakdown.board_power = (my_power as f64 - weighted_opp_power) * weights.board_power;
        breakdown.board_toughness =
            (my_toughness as f64 - weighted_opp_toughness) * weights.board_toughness;
        let my_hand = game.cards_in_zone(ZoneType::Hand, player).len();
        breakdown.hand_size = (my_hand as f64 - weighted_opp_hand) * weights.hand_size;
        breakdown.card_advantage = (my_nc as f64 - weighted_opp_nc) * weights.card_advantage;

        if p.life as f64 > weighted_opp_life && my_power > 0 {
            breakdown.aggression = my_power as f64 * weights.aggression;
        }
    } else {
        let mut total_opp_life = 0;
        let mut total_opp_creatures = 0;
        let mut total_opp_power = 0;
        let mut total_opp_toughness = 0;
        let mut total_opp_hand_size = 0usize;
        let mut total_opp_nc = 0;
        for &opp in &opponents {
            let o = game.player(opp);
            total_opp_life += o.life;
            let (opp_creatures, opp_power, opp_toughness, opp_nc) = board_stats(game, opp);
            total_opp_creatures += opp_creatures;
            total_opp_power += opp_power;
            total_opp_toughness += opp_toughness;
            total_opp_hand_size += game.cards_in_zone(ZoneType::Hand, opp).len();
            total_opp_nc += opp_nc;
        }

        let avg_opp_life = total_opp_life as f64 / opp_count;
        breakdown.life = (p.life as f64 - avg_opp_life) * weights.life;

        let (my_creatures, my_power, my_toughness, my_nc) = board_stats(game, player);
        breakdown.board_presence =
            (my_creatures - total_opp_creatures) as f64 * weights.board_presence;
        breakdown.board_power = (my_power - total_opp_power) as f64 * weights.board_power;
        breakdown.board_toughness =
            (my_toughness - total_opp_toughness) as f64 * weights.board_toughness;

        let avg_opp_hand = total_opp_hand_size as f64 / opp_count;
        let my_hand = game.cards_in_zone(ZoneType::Hand, player).len();
        breakdown.hand_size = (my_hand as f64 - avg_opp_hand) * weights.hand_size;

        let avg_opp_nc = total_opp_nc as f64 / opp_count;
        breakdown.card_advantage = (my_nc as f64 - avg_opp_nc) * weights.card_advantage;

        if p.life as f64 > avg_opp_life && my_power > 0 {
            breakdown.aggression = my_power as f64 * weights.aggression;
        }
    }

    // Phase: p.energy; manabrew: energy_counters.
    breakdown.hand_size += p.energy_counters as f64 * 0.1;

    Ok(breakdown)
}
```

### Notes on fidelity
- All weight tables (`Default`, `learned()` ×4, `KeywordBonuses::default`),
  `creature_combat_value` formula, the threat coefficients
  (`0.3/0.7/.min(10.0)/10.0`, `clamp(0.0,2.0)/2.0`, `.min(7.0)/7.0`,
  `0.4/0.2/0.15/0.25`), the energy `* 0.1`, the `for_turn` cutoffs (`0..=3`,
  `4..=7`), `WIN/LOSS = ±10000`, and the 2-vs-3+ branch split are reproduced
  byte-for-byte.
- `zone_quality` and `synergy` weights exist in `EvalWeights` but are **never
  read** in eval.rs (no breakdown field). Phase carries them for other modules /
  future use; keep them for struct/serde compatibility. Do not invent usage.
- `EvaluationBreakdown` has **7** fields (no zone_quality, no synergy) — matches
  the dimensions actually computed.

---

## 4. Dependencies on other phase-ai modules

This module does **not** stand alone. Two external phase-ai types are referenced:

1. **`crate::planner::ValueEstimate`** — used by `evaluate_for_planner`. Shape
   from usage: `struct ValueEstimate { value: f64, intent: StrategicIntent }`.
   Lives in the `planner` module port. `evaluate_for_planner` can be stubbed/
   deferred until `planner` is ported; the rest of eval.rs compiles without it.
2. **`crate::projection::Projection`** — used by `threat_level_projected` via
   `projection.state: GameState` (a hypothetical/look-ahead game state). Only the
   `.state` field is touched here. Port `projection` (or define a minimal
   `struct Projection { pub state: GameState, .. }`) before enabling the
   projected path; `threat_level` (the `None` path) needs nothing from it.

No other phase-ai module is required for the non-projected, non-planner core
(`evaluate_state` / `evaluate_state_breakdown` / `strategic_intent` /
`board_stats` / `threat_level` / `creature_combat_value`).

Suggested port order: eval.rs core first (stub the two deps), then `projection`,
then `planner`.

---

## 5. Risks — adapt vs infeasible

**R1 — raw vs layered P/T (semantic, low risk, decide explicitly).**
Phase reads `obj.power.unwrap_or(0)` = raw printed power. manabrew's idiomatic
accessor `Card::power()` (mod.rs:988) returns the **layered** value (static
buffs + counters), which is *more correct* for evaluation but diverges from a
literal port. Skeleton above uses `base_power`/`base_toughness` to match Phase
exactly. **Recommendation:** switch to `power()`/`toughness()` for real play
strength once parity-to-Phase is no longer the goal — flagged so the implementer
chooses consciously, in `board_stats`, `projected_power`, and
`evaluate_creature_with_bonuses`.

**R2 — `commander_lethal_headroom` reimplementation (medium).**
No manabrew helper. The port computes headroom from
`PlayerState.commander_damage_received: HashMap<u32,i32>` keyed by **source
commander id as u32** (state.rs:50). Verify the key really is the commander
`CardId.0` (api-state.md says "keyed by source commander id as u32"; confirm
against `player/commander.rs` / `player/service.rs:638,931` where the map is
written). If the engine keys it differently (e.g. by owner), adjust the lookup.
Threshold hardcoded to 21 — correct for standard commander but not for variant
thresholds; acceptable since manabrew has no per-format override.

**R3 — global battlefield → per-player scan (structural, low risk).**
Phase's `state.battlefield` + `obj.controller` filter is replaced by
`cards_in_zone(Battlefield, pid)`. Equivalent for "permanents controlled by pid"
**only if** manabrew files cards in their *controller's* battlefield zone (true
for forge-style control-change handling). If control-changed permanents stay in
the owner's zone, add a `controller == pid` guard. Confirm via
`creatures_on_battlefield` (game.rs:525) which already does the same scan — if it
filters by controller, mirror it; otherwise per-zone is fine.

**R4 — `WaitingFor::GameOver` mapping (low).**
Phase's terminal state is a `waiting_for` variant; manabrew uses
`game_over: bool` + `winner: Option<PlayerId>`. The `None` winner (draw) → 0.0
case is preserved. No behavioral risk.

**R5 — `format_config.starting_life` per-player substitution (low).**
Phase uses one format-global starting life; manabrew stores it per player
(`starting_life`, state.rs:17). Using the *target's* starting life is identical
in homogeneous formats; differs only in mixed-starting-life variants (e.g. one
Vanguard seat) — acceptable, arguably more correct.

**Nothing here is infeasible on the Forge-DSL engine.** All data the evaluator
needs (P/T, keywords, zones, life, energy, commander damage, opponents) is
exposed by `GameState`/`Card`/`PlayerState` accessors. The module is pure-read,
so no DSL/effect-resolution concerns apply.
```
