use forge_engine_core::game::GameState;
use forge_engine_core::ids::{CardId, PlayerId};

use crate::game_view_dto::{card_to_dto, CardDto};
use crate::ids_codec::parse_card_id;
use crate::prompt::{PlayerAction, PromptInput};

use super::{PromptAgent, Responder};

fn library_dtos(game: &GameState, cards: &[CardId]) -> Vec<CardDto> {
    cards
        .iter()
        .map(|&id| card_to_dto(game, id, &[], "library"))
        .collect()
}

pub(super) fn choose_scry<T: Responder>(
    agent: &mut PromptAgent<T>,
    game: &GameState,
    _player: PlayerId,
    cards: &[CardId],
) -> Vec<CardId> {
    let card_ids = PromptAgent::<T>::card_ids(cards);
    let dtos = library_dtos(game, cards);
    agent.send_prompt(
        PromptInput::Scry(forge_protocol::prompts::scry::ScryInput {
            card_ids,
            cards: dtos,
        }),
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
    game: &GameState,
    _player: PlayerId,
    cards: &[CardId],
) -> Vec<CardId> {
    let card_ids = PromptAgent::<T>::card_ids(cards);
    let dtos = library_dtos(game, cards);
    agent.send_prompt(
        PromptInput::Surveil(forge_protocol::prompts::surveil::SurveilInput {
            card_ids,
            cards: dtos,
        }),
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
    game: &GameState,
    _player: PlayerId,
    valid: &[CardId],
    max: usize,
    optional: bool,
) -> Vec<CardId> {
    let card_ids = PromptAgent::<T>::card_ids(valid);
    let cards = library_dtos(game, valid);
    agent.send_prompt(
        PromptInput::Dig(forge_protocol::prompts::dig::DigInput {
            card_ids,
            cards,
            num_to_take: max,
            optional,
        }),
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
    game: &GameState,
    _player: PlayerId,
    cards: &[CardId],
) -> Vec<CardId> {
    let card_ids = PromptAgent::<T>::card_ids(cards);
    let prompt_cards = library_dtos(game, cards);
    agent.send_prompt(
        PromptInput::ReorderLibrary(
            forge_protocol::prompts::reorder_library::ReorderLibraryInput {
                card_ids,
                cards: prompt_cards,
                destination: None,
                top_of_deck: true,
            },
        ),
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
