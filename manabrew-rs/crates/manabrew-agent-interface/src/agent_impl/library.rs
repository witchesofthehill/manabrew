use manabrew_engine::game::GameState;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_protocol::prompts::scry::ScryDestination;

use crate::game_view_dto::{card_to_dto, CardDto};
use crate::ids_codec::{card_id_str, parse_card_id};
use crate::prompt::*;

use super::{PromptAgent, Responder};

fn library_dtos(game: &GameState, cards: &[CardId]) -> Vec<CardDto> {
    cards
        .iter()
        .map(|&id| card_to_dto(game, id, "library"))
        .collect()
}

fn send_scry<T: Responder>(
    agent: &mut PromptAgent<T>,
    game: &GameState,
    source: Option<CardId>,
    cards: &[CardId],
    title: &str,
    description: &str,
    zones: Vec<ScryDestination>,
) -> Vec<Vec<CardId>> {
    agent.send_prompt(
        PromptInput::Scry(ScryInput {
            presentation: PromptPresentation {
                title: title.to_string(),
                description: Some(description.to_string()),
                text: None,
                source_card_id: source.map(card_id_str),
                targets: Vec::new(),
            },
            cards: library_dtos(game, cards),
            zones,
        }),
        source,
    );
    match agent.recv_action() {
        PromptOutput::Scry(ScryOutput::ScryDecision { zone_card_ids }) => zone_card_ids
            .into_iter()
            .map(|zone| zone.iter().filter_map(|id| parse_card_id(id)).collect())
            .collect(),
        _ => vec![cards.to_vec(), vec![]],
    }
}

pub(super) fn choose_scry<T: Responder>(
    agent: &mut PromptAgent<T>,
    game: &GameState,
    _player: PlayerId,
    source: Option<CardId>,
    cards: &[CardId],
) -> Vec<Vec<CardId>> {
    send_scry(
        agent,
        game,
        source,
        cards,
        "Scry",
        "Put any number on the bottom; the rest on top in any order.",
        vec![ScryDestination::LibraryTop, ScryDestination::LibraryBottom],
    )
}

pub(super) fn choose_surveil<T: Responder>(
    agent: &mut PromptAgent<T>,
    game: &GameState,
    _player: PlayerId,
    source: Option<CardId>,
    cards: &[CardId],
) -> Vec<Vec<CardId>> {
    send_scry(
        agent,
        game,
        source,
        cards,
        "Surveil",
        "Put any number into your graveyard; the rest on top in any order.",
        vec![ScryDestination::LibraryTop, ScryDestination::Graveyard],
    )
}

pub(super) fn choose_dig<T: Responder>(
    agent: &mut PromptAgent<T>,
    game: &GameState,
    _player: PlayerId,
    valid: &[CardId],
    max: usize,
    optional: bool,
) -> Vec<CardId> {
    let cards = library_dtos(game, valid);
    let min = if optional { 0 } else { max.min(1) };
    agent.send_prompt(
        PromptInput::ChooseCards(manabrew_protocol::prompts::choose_cards::ChooseCardsInput {
            presentation: PromptPresentation {
                title: "Dig".to_string(),
                description: Some("Choose cards to put into your hand.".to_string()),
                text: None,
                source_card_id: None,
                targets: Vec::new(),
            },
            cards,
            min,
            max,
        }),
        None,
    );
    match agent.recv_action() {
        PromptOutput::ChooseCards(ChooseCardsOutput::ChooseCardsDecision { chosen_card_ids }) => {
            chosen_card_ids
                .iter()
                .filter_map(|id| parse_card_id(id))
                .collect()
        }
        _ => valid.iter().copied().take(max).collect(),
    }
}

pub(super) fn choose_reorder_library<T: Responder>(
    agent: &mut PromptAgent<T>,
    game: &GameState,
    _player: PlayerId,
    cards: &[CardId],
) -> Vec<CardId> {
    let prompt_cards = library_dtos(game, cards);
    agent.send_prompt(
        PromptInput::ReorderCards(
            manabrew_protocol::prompts::reorder_cards::ReorderCardsInput {
                presentation: PromptPresentation {
                    title: "Reorder".to_string(),
                    description: Some("Arrange these cards on top of your library.".to_string()),
                    text: None,
                    source_card_id: None,
                    targets: Vec::new(),
                },
                cards: prompt_cards,
                target_label: "Top of Library".to_string(),
                top_of_deck: true,
            },
        ),
        None,
    );
    match agent.recv_action() {
        PromptOutput::ReorderCards(ReorderCardsOutput::ReorderDecision { ordered_card_ids }) => {
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
