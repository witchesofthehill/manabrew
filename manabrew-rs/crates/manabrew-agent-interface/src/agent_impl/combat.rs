use manabrew_engine::agent::CombatCostAction;
use manabrew_engine::combat::DefenderId;
use manabrew_engine::ids::{CardId, PlayerId};

use crate::game_view_dto::CardDto;
use crate::ids_codec::{card_id_str, parse_card_id};
use crate::prompt::{BlockAssignment, PlayerAction, PromptInput};

use super::{PromptAgent, Responder};

fn fallback_combat_assignment(
    blockers_in_order: &[CardId],
    defender: Option<DefenderId>,
    total_damage: i32,
) -> Vec<(Option<CardId>, i32)> {
    if total_damage <= 0 {
        return Vec::new();
    }
    if let Some(first) = blockers_in_order.first().copied() {
        return vec![(Some(first), total_damage)];
    }
    if defender.is_some() {
        return vec![(None, total_damage)];
    }
    Vec::new()
}

pub(super) fn choose_attackers<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    available: &[CardId],
    possible_defenders: &[DefenderId],
) -> Vec<(CardId, DefenderId)> {
    let available_attacker_ids = PromptAgent::<T>::card_ids(available);
    let possible_defender_dtos = PromptAgent::<T>::defender_ids_to_dtos(possible_defenders);
    agent.send_prompt(
        PromptInput::ChooseAttackers(
            manabrew_protocol::prompts::choose_attackers::ChooseAttackersInput {
                available_attacker_ids,
                possible_defender_ids: possible_defender_dtos,
            },
        ),
        None,
    );
    let default_defender = possible_defenders
        .first()
        .copied()
        .unwrap_or(DefenderId::Player(PlayerId(1)));
    match agent.recv_action() {
        PlayerAction::RestoreSnapshot { checkpoint_id } => {
            agent.pending_restore_checkpoint = Some(checkpoint_id);
            Vec::new()
        }
        PlayerAction::DeclareAttackers { assignments } => assignments
            .iter()
            .filter_map(|a| {
                let attacker = parse_card_id(&a.attacker_id)?;
                let defender =
                    PromptAgent::<T>::parse_defender_id(&a.defender_id, possible_defenders)
                        .unwrap_or(default_defender);
                Some((attacker, defender))
            })
            .collect(),
        _ => Vec::new(),
    }
}

pub(super) fn choose_blockers<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    attackers: &[CardId],
    available_blockers: &[CardId],
    _max_blockers: Option<usize>,
) -> Vec<(CardId, CardId)> {
    let attacker_ids = PromptAgent::<T>::card_ids(attackers);
    let available_blocker_ids = PromptAgent::<T>::card_ids(available_blockers);
    agent.send_prompt(
        PromptInput::ChooseBlockers(
            manabrew_protocol::prompts::choose_blockers::ChooseBlockersInput {
                attacker_ids,
                available_blocker_ids,
            },
        ),
        None,
    );
    match agent.recv_action() {
        PlayerAction::RestoreSnapshot { checkpoint_id } => {
            agent.pending_restore_checkpoint = Some(checkpoint_id);
            Vec::new()
        }
        PlayerAction::DeclareBlockers { assignments } => assignments
            .iter()
            .filter_map(
                |BlockAssignment {
                     blocker_id,
                     attacker_id,
                 }| {
                    let b = parse_card_id(blocker_id)?;
                    let a = parse_card_id(attacker_id)?;
                    Some((b, a))
                },
            )
            .collect(),
        _ => Vec::new(),
    }
}

pub(super) fn choose_damage_assignment_order<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    attacker: CardId,
    blockers: &[CardId],
) -> Vec<CardId> {
    let attacker_id = card_id_str(attacker);
    let blocker_ids: Vec<String> = blockers.iter().map(|&b| card_id_str(b)).collect();
    let blocker_cards: Vec<CardDto> = Vec::new(); // Blocker info available from gameView
    agent.send_prompt(
        PromptInput::ChooseDamageAssignmentOrder(manabrew_protocol::prompts::choose_damage_assignment_order::ChooseDamageAssignmentOrderInput {
            attacker_id,
            blocker_ids,
            blocker_cards,
        }),
        None,
    );
    match agent.recv_action() {
        PlayerAction::DamageAssignmentOrderDecision {
            ordered_blocker_ids,
        } => {
            let parsed: Vec<CardId> = ordered_blocker_ids
                .iter()
                .filter_map(|s| parse_card_id(s))
                .collect();
            if parsed.len() == blockers.len() {
                parsed
            } else {
                blockers.to_vec()
            }
        }
        _ => blockers.to_vec(),
    }
}

pub(super) fn choose_combat_damage_assignment<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    attacker: CardId,
    blockers_in_order: &[CardId],
    defender: Option<DefenderId>,
    total_damage: i32,
    attacker_has_deathtouch: bool,
) -> Vec<(Option<CardId>, i32)> {
    let attacker_id = card_id_str(attacker);
    let blocker_ids: Vec<String> = blockers_in_order.iter().map(|&b| card_id_str(b)).collect();
    let defender_id = defender.map(|d| match d {
        DefenderId::Player(pid) => format!("player-{}", pid.0),
        DefenderId::Permanent(cid) => format!("card-{}", cid.0),
    });
    agent.send_prompt(
        PromptInput::ChooseCombatDamageAssignment(manabrew_protocol::prompts::choose_combat_damage_assignment::ChooseCombatDamageAssignmentInput {
            attacker_id,
            blocker_ids: blocker_ids.clone(),
            defender_id: defender_id.clone(),
            total_damage,
            attacker_has_deathtouch,
        }),
        None,
    );

    match agent.recv_action() {
        PlayerAction::CombatDamageAssignmentDecision { assignments } => assignments
            .into_iter()
            .map(|entry| {
                if defender_id
                    .as_ref()
                    .map(|d| d == &entry.assignee_id)
                    .unwrap_or(false)
                {
                    (None, entry.damage)
                } else if let Some(blocker) = parse_card_id(&entry.assignee_id) {
                    if blockers_in_order.contains(&blocker) {
                        (Some(blocker), entry.damage)
                    } else {
                        (None, 0)
                    }
                } else {
                    (None, 0)
                }
            })
            .filter(|(_, damage)| *damage > 0)
            .collect(),
        _ => fallback_combat_assignment(blockers_in_order, defender, total_damage),
    }
}

pub(super) fn pay_combat_cost<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    attacker: CardId,
    cost: i32,
    description: &str,
    tappable_lands: &[CardId],
    untappable_lands: &[CardId],
    mana_pool_total: i32,
) -> CombatCostAction {
    let attacker_id = card_id_str(attacker);
    let attacker_name = agent
        .latest_view
        .as_ref()
        .and_then(|v| v.battlefield.iter().find(|c| c.id == attacker_id))
        .map(|c| c.name.clone())
        .unwrap_or_default();
    let tappable_land_ids = PromptAgent::<T>::card_ids(tappable_lands);
    let untappable_land_ids = PromptAgent::<T>::card_ids(untappable_lands);

    agent.send_prompt(
        PromptInput::PayCombatCost(
            manabrew_protocol::prompts::pay_combat_cost::PayCombatCostInput {
                attacker_id,
                attacker_name,
                cost,
                description: description.to_string(),
                tappable_land_ids,
                untappable_land_ids,
                mana_pool_total,
            },
        ),
        None,
    );
    match agent.recv_action() {
        PlayerAction::TapLand { card_id, .. } => parse_card_id(&card_id)
            .map(CombatCostAction::TapLand)
            .unwrap_or(CombatCostAction::Decline),
        PlayerAction::UntapLand { card_id } => parse_card_id(&card_id)
            .map(CombatCostAction::UntapLand)
            .unwrap_or(CombatCostAction::Decline),
        PlayerAction::PayCombatCost => CombatCostAction::Pay,
        _ => CombatCostAction::Decline,
    }
}

pub(super) fn exert_attackers<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    attackers: &[CardId],
) -> Vec<CardId> {
    let attacker_ids = PromptAgent::<T>::card_ids(attackers);
    let view = agent.view();
    let attacker_cards: Vec<CardDto> = attacker_ids
        .iter()
        .filter_map(|id| view.battlefield.iter().find(|c| c.id == *id).cloned())
        .collect();
    agent.send_prompt(
        PromptInput::ChooseExertAttackers(
            manabrew_protocol::prompts::choose_exert_attackers::ChooseExertAttackersInput {
                attacker_ids,
                attacker_cards,
            },
        ),
        None,
    );
    match agent.recv_action() {
        PlayerAction::ExertDecision {
            chosen_attacker_ids,
        } => chosen_attacker_ids
            .iter()
            .filter_map(|id| parse_card_id(id))
            .filter(|cid| attackers.contains(cid))
            .collect(),
        _ => vec![],
    }
}

pub(super) fn enlist_attackers<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    attackers: &[CardId],
) -> Vec<CardId> {
    let attacker_ids = PromptAgent::<T>::card_ids(attackers);
    let view = agent.view();
    let attacker_cards: Vec<CardDto> = attacker_ids
        .iter()
        .filter_map(|id| view.battlefield.iter().find(|c| c.id == *id).cloned())
        .collect();
    agent.send_prompt(
        PromptInput::ChooseEnlistAttackers(
            manabrew_protocol::prompts::choose_enlist_attackers::ChooseEnlistAttackersInput {
                attacker_ids,
                attacker_cards,
            },
        ),
        None,
    );
    match agent.recv_action() {
        PlayerAction::EnlistDecision {
            chosen_attacker_ids,
        } => chosen_attacker_ids
            .iter()
            .filter_map(|id| parse_card_id(id))
            .filter(|cid| attackers.contains(cid))
            .collect(),
        _ => vec![],
    }
}
