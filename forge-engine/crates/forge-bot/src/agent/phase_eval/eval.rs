// Adapted from phase-rs/phase crates/phase-ai (Apache-2.0). See THIRD-PARTY-NOTICES.md.
use forge_agent_interface::game_view_dto::CardDto;

use super::view::{has_kw, power_of, toughness_of, BotView};

#[derive(Debug, Clone)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StrategicIntent {
    PushLethal,
    Stabilize,
    PreserveAdvantage,
    Develop,
}

pub fn creature_combat_value(c: &CardDto, bonuses: &KeywordBonuses) -> f64 {
    let power = power_of(c) as f64;
    let toughness = toughness_of(c) as f64;
    let mut value = power * 1.5 + toughness;

    if has_kw(c, "flying") {
        value += power * bonuses.flying_mult;
    }
    if has_kw(c, "trample") {
        value += power * bonuses.trample_mult;
    }
    if has_kw(c, "deathtouch") {
        value += bonuses.deathtouch_flat;
    }
    if has_kw(c, "lifelink") {
        value += power * bonuses.lifelink_mult;
    }
    if has_kw(c, "hexproof") {
        value += bonuses.hexproof_flat;
    }
    if has_kw(c, "indestructible") {
        value += bonuses.indestructible_flat;
    }
    if has_kw(c, "first strike") || has_kw(c, "double strike") {
        value += power * bonuses.first_strike_mult;
    }
    if has_kw(c, "vigilance") {
        value += bonuses.vigilance_flat;
    }
    if has_kw(c, "menace") {
        value += power * bonuses.menace_mult;
    }

    value
}

pub fn evaluate_creature(c: &CardDto, bonuses: &KeywordBonuses) -> f64 {
    let mut value = creature_combat_value(c, bonuses);
    if c.tapped {
        value -= bonuses.tapped_penalty;
    }
    value
}

fn board_stats(view: &BotView, pid: &str) -> (i32, i32, i32, i32) {
    let mut creatures = 0;
    let mut total_power = 0;
    let mut total_toughness = 0;
    let mut non_creatures = 0;

    for c in &view.view.battlefield {
        if c.controller_id != pid {
            continue;
        }
        if super::view::is_creature(c) {
            creatures += 1;
            total_power += power_of(c);
            total_toughness += toughness_of(c);
        } else if !super::view::is_land(c) {
            non_creatures += 1;
        }
    }

    (creatures, total_power, total_toughness, non_creatures)
}

pub fn threat_level(view: &BotView, target: &str) -> f64 {
    let Some(tp) = view.player(target) else {
        return 0.0;
    };
    let starting_life = view.starting_life().max(1.0);
    let (creatures, power, _, _) = board_stats(view, target);

    let board_score = (creatures as f64 * 0.3 + power as f64 * 0.7).min(10.0) / 10.0;
    let life_ratio = (tp.life as f64 / starting_life).clamp(0.0, 2.0) / 2.0;
    let hand_score = (tp.hand.len() as f64).min(7.0) / 7.0;
    let cmd_threat =
        (tp.commander_damage.values().copied().max().unwrap_or(0) as f64 / 21.0).min(1.0);

    board_score * 0.4 + life_ratio * 0.2 + hand_score * 0.15 + cmd_threat * 0.25
}

pub fn strategic_intent(view: &BotView) -> StrategicIntent {
    let opponents = view.opponents();
    if opponents.is_empty() {
        return StrategicIntent::PreserveAdvantage;
    }

    let (_, my_power, _, _) = board_stats(view, &view.me);
    let total_opp_power: i32 = opponents.iter().map(|o| board_stats(view, &o.id).1).sum();
    let min_opp_life = opponents.iter().map(|o| o.life).min().unwrap_or(i32::MAX);
    let my_life = view.my_life();
    let avg_opp_life =
        opponents.iter().map(|o| o.life).sum::<i32>() as f64 / opponents.len() as f64;

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
