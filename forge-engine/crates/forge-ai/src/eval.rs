// Adapted from phase-rs/phase crates/phase-ai (Apache-2.0). See THIRD-PARTY-NOTICES.md.
use forge_engine_core::card::Card;
use forge_engine_core::game::GameState;
use forge_engine_core::ids::PlayerId;
use forge_foundation::ZoneType;

use crate::stats::{CreatureStats, StrategicIntent};

const WIN_SCORE: f64 = 10000.0;
const LOSS_SCORE: f64 = -10000.0;

impl CreatureStats for Card {
    fn power(&self) -> i32 {
        Card::power(self)
    }
    fn toughness(&self) -> i32 {
        Card::toughness(self)
    }
    fn tapped(&self) -> bool {
        self.tapped
    }
    fn has_kw(&self, kw: &str) -> bool {
        match kw {
            "Trample" => self.has_trample(),
            "Deathtouch" => self.has_deathtouch(),
            _ => self.has_keyword(kw),
        }
    }
}

#[derive(Debug, Clone)]
pub struct EvalWeights {
    pub life: f64,
    pub aggression: f64,
    pub board_presence: f64,
    pub board_power: f64,
    pub board_toughness: f64,
    pub hand_size: f64,
    pub card_advantage: f64,
}

impl EvalWeights {
    pub fn learned(turn: u32) -> Self {
        match turn {
            0..=3 => EvalWeights {
                life: 0.4636,
                aggression: 0.5,
                board_presence: 2.0636,
                board_power: 1.0174,
                board_toughness: 1.0,
                hand_size: 1.3716,
                card_advantage: 2.5,
            },
            4..=7 => EvalWeights {
                life: 0.5838,
                aggression: 0.5,
                board_presence: 1.9888,
                board_power: 0.8031,
                board_toughness: 1.0,
                hand_size: 2.396,
                card_advantage: 2.5,
            },
            _ => EvalWeights {
                life: 0.4912,
                aggression: 0.5,
                board_presence: 1.7317,
                board_power: 0.6686,
                board_toughness: 1.0,
                hand_size: 2.5,
                card_advantage: 1.945,
            },
        }
    }
}

/// (creature_count, total_power, total_toughness, non_creature_permanents)
/// controlled by `pid`. Reads by controller (not owner) so control-changing
/// effects are scored for the player who actually wields the permanent.
pub fn board_stats(game: &GameState, pid: PlayerId) -> (i32, i32, i32, i32) {
    let mut creatures = 0;
    let mut total_power = 0;
    let mut total_toughness = 0;
    let mut non_creatures = 0;

    for card in &game.cards {
        if card.zone != ZoneType::Battlefield || card.controller != pid {
            continue;
        }
        if card.is_creature() {
            creatures += 1;
            total_power += card.power();
            total_toughness += card.toughness();
        } else if !card.is_land() {
            non_creatures += 1;
        }
    }

    (creatures, total_power, total_toughness, non_creatures)
}

fn opponents(game: &GameState, me: PlayerId) -> Vec<PlayerId> {
    game.player_order
        .iter()
        .copied()
        .filter(|&p| p != me)
        .collect()
}

fn life(game: &GameState, pid: PlayerId) -> i32 {
    game.player(pid).life
}

fn hand_size(game: &GameState, pid: PlayerId) -> usize {
    game.cards_in_zone(ZoneType::Hand, pid).len()
}

fn starting_life(game: &GameState) -> f64 {
    let commander = game
        .player_order
        .iter()
        .any(|&pid| !game.cards_in_zone(ZoneType::Command, pid).is_empty());
    if commander {
        40.0
    } else {
        20.0
    }
}

pub fn threat_level(game: &GameState, target: PlayerId) -> f64 {
    let start = starting_life(game).max(1.0);
    let (creatures, power, _, _) = board_stats(game, target);

    let board_score = (creatures as f64 * 0.3 + power as f64 * 0.7).min(10.0) / 10.0;
    let life_ratio = (life(game, target) as f64 / start).clamp(0.0, 2.0) / 2.0;
    let hand_score = (hand_size(game, target) as f64).min(7.0) / 7.0;

    board_score * 0.5 + life_ratio * 0.25 + hand_score * 0.25
}

pub fn strategic_intent(game: &GameState, me: PlayerId) -> StrategicIntent {
    let opps = opponents(game, me);
    if opps.is_empty() {
        return StrategicIntent::PreserveAdvantage;
    }

    let (_, my_power, _, _) = board_stats(game, me);
    let total_opp_power: i32 = opps.iter().map(|&o| board_stats(game, o).1).sum();
    let min_opp_life = opps
        .iter()
        .map(|&o| life(game, o))
        .min()
        .unwrap_or(i32::MAX);
    let my_life = life(game, me);
    let avg_opp_life = opps.iter().map(|&o| life(game, o)).sum::<i32>() as f64 / opps.len() as f64;

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

/// Score the state from `me`'s perspective; higher is better. Opponent scores
/// are threat-weighted in multiplayer so the AI focuses the biggest threat.
pub fn evaluate_state(game: &GameState, me: PlayerId, weights: &EvalWeights) -> f64 {
    if game.game_over {
        return match game.winner {
            Some(w) if w == me => WIN_SCORE,
            Some(_) => LOSS_SCORE,
            None => 0.0,
        };
    }

    let my_life = life(game, me);
    if my_life <= 0 {
        return LOSS_SCORE;
    }

    let opps = opponents(game, me);
    if !opps.is_empty() && opps.iter().all(|&o| life(game, o) <= 0) {
        return WIN_SCORE;
    }
    let opp_count = opps.len().max(1) as f64;

    let (my_creatures, my_power, my_toughness, my_nc) = board_stats(game, me);

    let threats: Vec<(PlayerId, f64)> = opps.iter().map(|&o| (o, threat_level(game, o))).collect();
    let total_threat: f64 = threats.iter().map(|(_, t)| t).sum::<f64>().max(0.01);
    let multi = opps.len() >= 2;

    let mut weighted_life = 0.0;
    let mut weighted_creatures = 0.0;
    let mut weighted_power = 0.0;
    let mut weighted_toughness = 0.0;
    let mut weighted_hand = 0.0;
    let mut weighted_nc = 0.0;
    for &(o, threat) in &threats {
        let w = if multi {
            threat / total_threat
        } else {
            1.0 / opp_count
        };
        let (oc, op, ot, onc) = board_stats(game, o);
        weighted_life += life(game, o) as f64 * w;
        weighted_creatures += oc as f64 * w;
        weighted_power += op as f64 * w;
        weighted_toughness += ot as f64 * w;
        weighted_hand += hand_size(game, o) as f64 * w;
        weighted_nc += onc as f64 * w;
    }

    let mut score = 0.0;
    score += (my_life as f64 - weighted_life) * weights.life;
    score += (my_creatures as f64 - weighted_creatures) * weights.board_presence;
    score += (my_power as f64 - weighted_power) * weights.board_power;
    score += (my_toughness as f64 - weighted_toughness) * weights.board_toughness;
    score += (hand_size(game, me) as f64 - weighted_hand) * weights.hand_size;
    score += (my_nc as f64 - weighted_nc) * weights.card_advantage;
    if my_life as f64 > weighted_life && my_power > 0 {
        score += my_power as f64 * weights.aggression;
    }

    score
}
