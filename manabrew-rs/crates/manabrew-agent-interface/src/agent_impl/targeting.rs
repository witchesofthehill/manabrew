use forge_foundation::ZoneType;
use manabrew_engine::agent::TargetChoice;
use manabrew_engine::ids::{CardId, PlayerId};

use crate::game_view_dto::TargetingIntent;
use crate::ids_codec::{parse_card_id, parse_player_id, stack_id_str};
use crate::prompt::{PlayerAction, PromptInput, TargetRef};

use super::{PromptAgent, Responder};

fn board_targets(
    candidates: Vec<TargetRef>,
    hostile: bool,
    intent: TargetingIntent,
) -> PromptInput {
    PromptInput::ChooseBoardTargets(
        manabrew_protocol::prompts::choose_board_targets::ChooseBoardTargetsInput {
            candidates,
            hostile,
            intent,
            min_targets: 1,
            max_targets: 1,
            chosen_targets: 0,
        },
    )
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
        .map(|id| TargetRef::Player { id })
        .collect();
    agent.send_prompt(board_targets(candidates, hostile, intent), source);
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
        .map(|id| TargetRef::Card { id })
        .collect();
    agent.send_prompt(board_targets(candidates, hostile, intent), source);
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
        .map(|id| TargetRef::Card { id })
        .collect();
    agent.send_prompt(
        board_targets(candidates, intent.is_hostile(), intent),
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
        .map(|id| TargetRef::Player { id })
        .collect();
    candidates.extend(
        PromptAgent::<T>::card_ids(valid_cards)
            .into_iter()
            .map(|id| TargetRef::Card { id }),
    );
    agent.send_prompt(board_targets(candidates, hostile, intent), source);
    match agent.recv_action() {
        PlayerAction::BoardTargets { chosen } => chosen
            .into_iter()
            .find_map(|r| match r {
                TargetRef::Player { id } => parse_player_id(&id).map(TargetChoice::Player),
                TargetRef::Card { id } => parse_card_id(&id).map(TargetChoice::Card),
                TargetRef::Spell { .. } => None,
            })
            .unwrap_or(TargetChoice::None),
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
        .map(|&id| TargetRef::Spell {
            id: stack_id_str(id),
        })
        .collect();
    agent.send_prompt(
        board_targets(candidates, intent.is_hostile(), intent),
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
        .map(|id| TargetRef::Card { id })
        .collect();
    agent.send_prompt(
        board_targets(candidates, true, TargetingIntent::Sacrifice),
        source,
    );
    agent.recv_card_choice_or_first(valid)
}
