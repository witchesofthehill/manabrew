// Adapted from phase-rs/phase crates/phase-ai (Apache-2.0). See THIRD-PARTY-NOTICES.md.
use forge_agent_interface::game_view_dto::CardDto;
use forge_ai::stats::{self, CreatureStats};
pub use forge_ai::stats::{KeywordBonuses, StrategicIntent};

use super::view::{has_kw, is_creature, is_land, power_of, toughness_of, BotView};

// CardDto and CreatureStats are both foreign here, so the impl rides a local
// newtype; the shared scoring logic lives once in `forge_ai::stats`.
struct CardStats<'a>(&'a CardDto);

impl CreatureStats for CardStats<'_> {
    fn power(&self) -> i32 {
        power_of(self.0)
    }
    fn toughness(&self) -> i32 {
        toughness_of(self.0)
    }
    fn tapped(&self) -> bool {
        self.0.tapped
    }
    fn has_kw(&self, kw: &str) -> bool {
        has_kw(self.0, kw)
    }
}

pub fn creature_combat_value(c: &CardDto, b: &KeywordBonuses) -> f64 {
    stats::creature_combat_value(&CardStats(c), b)
}

pub fn evaluate_creature(c: &CardDto, b: &KeywordBonuses) -> f64 {
    stats::evaluate_creature(&CardStats(c), b)
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
        if is_creature(c) {
            creatures += 1;
            total_power += power_of(c);
            total_toughness += toughness_of(c);
        } else if !is_land(c) {
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
