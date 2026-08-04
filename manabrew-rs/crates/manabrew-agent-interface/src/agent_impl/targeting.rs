use forge_foundation::ZoneType;
use manabrew_engine::agent::TargetChoice;
use manabrew_engine::ids::{CardId, PlayerId};

use crate::game_view_dto::{
    intent_is_hostile, target_ref_card, target_ref_player, target_ref_spell, TargetingIntent,
};
use crate::ids_codec::{parse_card_id, parse_player_id, stack_id_str};
use crate::prompt::*;

use super::{PromptAgent, Responder};

fn board_targets(
    candidates: Vec<TargetRef>,
    hostile: bool,
    intent: TargetingIntent,
    label: String,
    cancellable: bool,
) -> PromptInput {
    PromptInput::ChooseBoardTargets(
        manabrew_protocol::prompts::choose_board_targets::ChooseBoardTargetsInput {
            presentation: PromptPresentation {
                title: label,
                description: None,
                text: None,
                targets: Vec::new(),
            },
            candidates,
            hostile,
            intent,
            min_targets: 1,
            max_targets: 1,
            chosen_targets: 0,
            cancellable,
        },
    )
}

pub(super) fn choose_board_targets_multi<T: Responder>(
    agent: &mut PromptAgent<T>,
    valid: &[CardId],
    intent: TargetingIntent,
    label: &str,
    source: Option<CardId>,
) -> Vec<CardId> {
    let total = valid.len() as i32;
    let mut remaining: Vec<CardId> = valid.to_vec();
    let mut chosen: Vec<CardId> = Vec::new();
    while !remaining.is_empty() {
        let candidates: Vec<TargetRef> = PromptAgent::<T>::card_ids(&remaining)
            .into_iter()
            .map(target_ref_card)
            .collect();
        agent.send_prompt(
            PromptInput::ChooseBoardTargets(
                manabrew_protocol::prompts::choose_board_targets::ChooseBoardTargetsInput {
                    presentation: PromptPresentation {
                        title: label.to_string(),
                        description: None,
                        text: None,
                        targets: Vec::new(),
                    },
                    candidates,
                    hostile: false,
                    intent,
                    min_targets: 0,
                    max_targets: total,
                    chosen_targets: chosen.len() as i32,
                    cancellable: agent.targeting_cancellable,
                },
            ),
            source,
        );
        match agent.recv_action() {
            PromptOutput::ChooseBoardTargets(ChooseBoardTargetsOutput::Cancel) => {
                agent.targeting_cancelled = true;
                break;
            }
            PromptOutput::ChooseBoardTargets(ChooseBoardTargetsOutput::BoardTargets {
                chosen: picked,
            }) if !picked.is_empty() => {
                let mut advanced = false;
                for r in picked {
                    if r.kind == TargetKind::Card {
                        if let Some(cid) = parse_card_id(&r.id) {
                            if remaining.contains(&cid) {
                                remaining.retain(|c| *c != cid);
                                chosen.push(cid);
                                advanced = true;
                            }
                        }
                    }
                }
                if !advanced {
                    break;
                }
            }
            _ => break,
        }
    }
    chosen
}

fn player_target_title(intent: TargetingIntent) -> String {
    match intent {
        TargetingIntent::Hostile | TargetingIntent::Friendly => "Choose a player".to_string(),
        TargetingIntent::LoseLife => "Choose player to lose life".to_string(),
        TargetingIntent::GainControl => "Choose player to control".to_string(),
        _ => format!("Choose player to {}", intent.to_string().to_lowercase()),
    }
}

pub(super) fn choose_target_player<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid: &[PlayerId],
    source: Option<CardId>,
    hostile: bool,
    intent: TargetingIntent,
) -> Option<PlayerId> {
    let candidates = PromptAgent::<T>::player_ids(valid)
        .into_iter()
        .map(target_ref_player)
        .collect();
    agent.send_prompt(
        board_targets(
            candidates,
            hostile,
            intent,
            player_target_title(intent),
            agent.targeting_cancellable,
        ),
        source,
    );
    agent.recv_player_choice_or_first(valid)
}

pub(super) fn choose_target_card<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid: &[CardId],
    source: Option<CardId>,
    hostile: bool,
    intent: TargetingIntent,
) -> Option<CardId> {
    let candidates = PromptAgent::<T>::card_ids(valid)
        .into_iter()
        .map(target_ref_card)
        .collect();
    agent.send_prompt(
        board_targets(
            candidates,
            hostile,
            intent,
            intent.to_string(),
            agent.targeting_cancellable,
        ),
        source,
    );
    agent.recv_card_choice_or_first(valid)
}

pub(super) fn choose_target_card_from_zone<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    _zone: ZoneType,
    valid: &[CardId],
    source: Option<CardId>,
    _hostile: bool,
    intent: TargetingIntent,
) -> Option<CardId> {
    let candidates = PromptAgent::<T>::card_ids(valid)
        .into_iter()
        .map(target_ref_card)
        .collect();
    agent.send_prompt(
        board_targets(
            candidates,
            intent_is_hostile(intent),
            intent,
            intent.to_string(),
            agent.targeting_cancellable,
        ),
        source,
    );
    agent.recv_card_choice_or_first(valid)
}

pub(super) fn choose_target_any<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid_players: &[PlayerId],
    valid_cards: &[CardId],
    source: Option<CardId>,
    hostile: bool,
    intent: TargetingIntent,
) -> TargetChoice {
    let mut candidates: Vec<TargetRef> = PromptAgent::<T>::player_ids(valid_players)
        .into_iter()
        .map(target_ref_player)
        .collect();
    candidates.extend(
        PromptAgent::<T>::card_ids(valid_cards)
            .into_iter()
            .map(target_ref_card),
    );
    agent.send_prompt(
        board_targets(
            candidates,
            hostile,
            intent,
            intent.to_string(),
            agent.targeting_cancellable,
        ),
        source,
    );
    match agent.recv_action() {
        PromptOutput::ChooseBoardTargets(ChooseBoardTargetsOutput::Cancel) => {
            agent.targeting_cancelled = true;
            TargetChoice::None
        }
        PromptOutput::ChooseBoardTargets(ChooseBoardTargetsOutput::BoardTargets { chosen }) => {
            chosen
                .into_iter()
                .find_map(|r| match r.kind {
                    TargetKind::Player => parse_player_id(&r.id).map(TargetChoice::Player),
                    TargetKind::Card => parse_card_id(&r.id).map(TargetChoice::Card),
                    TargetKind::Spell => None,
                })
                .unwrap_or(TargetChoice::None)
        }
        _ => {
            if let Some(&pid) = valid_players.first() {
                TargetChoice::Player(pid)
            } else if let Some(&cid) = valid_cards.first() {
                TargetChoice::Card(cid)
            } else {
                TargetChoice::None
            }
        }
    }
}

pub(super) fn choose_target_spell<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid: &[u32],
    source: Option<CardId>,
) -> Option<u32> {
    let intent = TargetingIntent::Counter;
    let candidates = valid
        .iter()
        .map(|&id| target_ref_spell(stack_id_str(id)))
        .collect();
    agent.send_prompt(
        board_targets(
            candidates,
            intent_is_hostile(intent),
            intent,
            intent.to_string(),
            agent.targeting_cancellable,
        ),
        source,
    );
    agent.recv_spell_choice_or_first(valid)
}

pub(super) fn choose_sacrifice<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid: &[CardId],
    source: Option<CardId>,
) -> Option<CardId> {
    let candidates = PromptAgent::<T>::card_ids(valid)
        .into_iter()
        .map(target_ref_card)
        .collect();
    agent.send_prompt(
        board_targets(
            candidates,
            true,
            TargetingIntent::Sacrifice,
            TargetingIntent::Sacrifice.to_string(),
            false,
        ),
        source,
    );
    agent.recv_card_choice_or_first(valid)
}
