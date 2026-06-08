// Adapted from phase-rs/phase crates/phase-ai (Apache-2.0). See THIRD-PARTY-NOTICES.md.
use std::collections::HashSet;

use forge_agent_interface::game_view_dto::{CardDto, GameViewDto};
use forge_agent_interface::prompt::{
    AttackAssignment, BlockAssignment, DefenderIdDto, PlayerAction,
};

use super::eval::{
    creature_combat_value, strategic_intent, threat_level, KeywordBonuses, StrategicIntent,
};
use super::view::{has_kw, power_of, toughness_of, BotView};

fn first_strike(c: &CardDto) -> bool {
    has_kw(c, "first strike") || has_kw(c, "double strike")
}

fn can_block(attacker: &CardDto, blocker: &CardDto) -> bool {
    if has_kw(attacker, "flying") && !has_kw(blocker, "flying") && !has_kw(blocker, "reach") {
        return false;
    }
    true
}

fn deals_lethal(attacker: &CardDto, defender: &CardDto) -> bool {
    if has_kw(defender, "indestructible") {
        return false;
    }
    let p = power_of(attacker);
    p > 0 && (has_kw(attacker, "deathtouch") || p >= toughness_of(defender))
}

fn combat_outcome(attacker: &CardDto, blocker: &CardDto) -> (bool, bool) {
    let mut attacker_dies = deals_lethal(blocker, attacker);
    let mut blocker_dies = deals_lethal(attacker, blocker);

    if first_strike(attacker) && !first_strike(blocker) && blocker_dies {
        attacker_dies = false;
    }
    if first_strike(blocker) && !first_strike(attacker) && attacker_dies {
        blocker_dies = false;
    }

    (attacker_dies, blocker_dies)
}

fn best_defender(view: &BotView, defenders: &[DefenderIdDto]) -> String {
    defenders
        .iter()
        .filter(|d| d.id.starts_with("player-"))
        .max_by(|a, b| threat_level(view, &a.id).total_cmp(&threat_level(view, &b.id)))
        .map(|d| d.id.clone())
        .or_else(|| defenders.first().map(|d| d.id.clone()))
        .unwrap_or_else(|| "player-1".to_string())
}

pub fn choose_attackers(
    me: &str,
    game_view: &GameViewDto,
    available_attacker_ids: &[String],
    possible_defender_ids: &[DefenderIdDto],
) -> PlayerAction {
    let view = BotView::new(game_view, me);
    let defender = best_defender(&view, possible_defender_ids);
    let intent = strategic_intent(&view);
    let bonuses = KeywordBonuses::default();

    let blockers: Vec<&CardDto> = view
        .opponents()
        .iter()
        .flat_map(|o| view.creatures_of(&o.id))
        .filter(|c| !c.tapped)
        .collect();

    let mut assignments = Vec::new();
    for id in available_attacker_ids {
        let Some(attacker) = view.card_by_id(id) else {
            continue;
        };
        if power_of(attacker) <= 0 {
            continue;
        }

        let attack = if intent == StrategicIntent::PushLethal {
            true
        } else {
            should_attack(attacker, &blockers, &bonuses)
        };

        if attack {
            assignments.push(AttackAssignment {
                attacker_id: id.clone(),
                defender_id: defender.clone(),
            });
        }
    }

    PlayerAction::DeclareAttackers { assignments }
}

fn should_attack(attacker: &CardDto, blockers: &[&CardDto], bonuses: &KeywordBonuses) -> bool {
    let viable: Vec<&&CardDto> = blockers.iter().filter(|b| can_block(attacker, b)).collect();
    if viable.is_empty() {
        return true;
    }
    if has_kw(attacker, "vigilance") {
        return true;
    }

    viable.iter().all(|b| {
        let (attacker_dies, blocker_dies) = combat_outcome(attacker, b);
        if !attacker_dies {
            return true;
        }
        blocker_dies
            && creature_combat_value(attacker, bonuses) <= creature_combat_value(b, bonuses)
    })
}

pub fn choose_blockers(
    me: &str,
    game_view: &GameViewDto,
    attacker_ids: &[String],
    available_blocker_ids: &[String],
) -> PlayerAction {
    let view = BotView::new(game_view, me);
    let bonuses = KeywordBonuses::default();

    let mut attackers: Vec<&CardDto> = attacker_ids
        .iter()
        .filter_map(|id| view.card_by_id(id))
        .collect();
    attackers.sort_by_key(|c| -power_of(c));

    let blockers: Vec<&CardDto> = available_blocker_ids
        .iter()
        .filter_map(|id| view.card_by_id(id))
        .collect();

    let incoming: i32 = attackers.iter().map(|a| power_of(a)).sum();
    let must_survive = incoming >= view.my_life();

    let mut used: HashSet<String> = HashSet::new();
    let mut assignments = Vec::new();

    for attacker in &attackers {
        let choice = blockers
            .iter()
            .filter(|b| !used.contains(&b.id) && can_block(attacker, b))
            .filter_map(|b| {
                let (attacker_dies, blocker_dies) = combat_outcome(attacker, b);
                if !attacker_dies {
                    return None;
                }
                let survives = !blocker_dies;
                let trades_up = blocker_dies
                    && creature_combat_value(b, &bonuses)
                        <= creature_combat_value(attacker, &bonuses);
                if survives || trades_up {
                    Some((b, creature_combat_value(b, &bonuses)))
                } else {
                    None
                }
            })
            .min_by(|a, b| a.1.total_cmp(&b.1));

        if let Some((blocker, _)) = choice {
            used.insert(blocker.id.clone());
            assignments.push(BlockAssignment {
                blocker_id: blocker.id.clone(),
                attacker_id: attacker.id.clone(),
            });
        }
    }

    if must_survive {
        let mut unblocked: i32 = attackers
            .iter()
            .filter(|a| !assignments.iter().any(|x| x.attacker_id == a.id))
            .map(|a| power_of(a))
            .sum();

        for attacker in &attackers {
            if unblocked < view.my_life() {
                break;
            }
            if assignments.iter().any(|x| x.attacker_id == attacker.id) {
                continue;
            }
            let chump = blockers
                .iter()
                .filter(|b| !used.contains(&b.id) && can_block(attacker, b))
                .min_by(|a, b| {
                    creature_combat_value(a, &bonuses)
                        .total_cmp(&creature_combat_value(b, &bonuses))
                });
            if let Some(blocker) = chump {
                used.insert(blocker.id.clone());
                unblocked -= power_of(attacker);
                assignments.push(BlockAssignment {
                    blocker_id: blocker.id.clone(),
                    attacker_id: attacker.id.clone(),
                });
            }
        }
    }

    PlayerAction::DeclareBlockers { assignments }
}
