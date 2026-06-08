use forge_engine_core::game::GameState;
use forge_engine_core::ids::{CardId, PlayerId};

use crate::game_view_dto::{card_to_dto, CardDto};
use crate::ids_codec::parse_card_id;
use crate::prompt::{AgentPromptInner, PlayerAction};

use super::{PromptAgent, Responder};

pub(super) fn on_library_peek<T: Responder>(
    agent: &mut PromptAgent<T>,
    game: &GameState,
    cards: &[CardId],
) {
    agent.peeked_library_cards = cards
        .iter()
        .map(|&id| card_to_dto(game, id, &[], "library"))
        .collect();
}

pub(super) fn choose_scry<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    cards: &[CardId],
) -> Vec<CardId> {
    let card_ids = PromptAgent::<T>::card_ids(cards);
    let peeked = std::mem::take(&mut agent.peeked_library_cards);
    agent.send_prompt(
        AgentPromptInner::Scry {
            card_ids,
            cards: peeked,
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::ScryDecision { bottom_card_ids } => bottom_card_ids
            .iter()
            .filter_map(|id| parse_card_id(id))
            .collect(),
        _ => vec![],
    }
}

pub(super) fn choose_surveil<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    cards: &[CardId],
) -> Vec<CardId> {
    let card_ids = PromptAgent::<T>::card_ids(cards);
    let peeked = std::mem::take(&mut agent.peeked_library_cards);
    agent.send_prompt(
        AgentPromptInner::Surveil {
            card_ids,
            cards: peeked,
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::SurveilDecision { graveyard_card_ids } => graveyard_card_ids
            .iter()
            .filter_map(|id| parse_card_id(id))
            .collect(),
        _ => vec![],
    }
}

pub(super) fn choose_dig<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid: &[CardId],
    max: usize,
    optional: bool,
) -> Vec<CardId> {
    let card_ids = PromptAgent::<T>::card_ids(valid);
    let peeked = std::mem::take(&mut agent.peeked_library_cards);
    // Filter peeked to only valid cards (ChangeValid$ may have narrowed the list).
    let valid_peeked: Vec<CardDto> = peeked
        .into_iter()
        .filter(|dto| card_ids.contains(&dto.id))
        .collect();
    agent.send_prompt(
        AgentPromptInner::Dig {
            card_ids,
            cards: valid_peeked,
            num_to_take: max,
            optional,
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::DigDecision { chosen_card_ids } => chosen_card_ids
            .iter()
            .filter_map(|id| parse_card_id(id))
            .collect(),
        _ => valid.iter().copied().take(max).collect(),
    }
}

pub(super) fn choose_reorder_library<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    cards: &[CardId],
) -> Vec<CardId> {
    let card_ids = PromptAgent::<T>::card_ids(cards);
    let peeked = std::mem::take(&mut agent.peeked_library_cards);
    let prompt_cards: Vec<CardDto> = peeked
        .into_iter()
        .filter(|dto| card_ids.contains(&dto.id))
        .collect();
    agent.send_prompt(
        AgentPromptInner::ReorderLibrary {
            card_ids,
            cards: prompt_cards,
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::ReorderLibraryDecision { ordered_card_ids } => {
            let parsed: Vec<CardId> = ordered_card_ids
                .iter()
                .filter_map(|s| parse_card_id(s))
                .collect();
            // Validate: must contain exactly the same cards
            if parsed.len() == cards.len() && cards.iter().all(|id| parsed.contains(id)) {
                parsed
            } else {
                cards.to_vec()
            }
        }
        _ => cards.to_vec(),
    }
}
