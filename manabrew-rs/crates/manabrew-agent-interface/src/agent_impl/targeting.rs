use forge_foundation::ZoneType;
use manabrew_engine::agent::TargetChoice;
use manabrew_engine::ids::{CardId, PlayerId};

use crate::game_view_dto::{CardDto, TargetingIntent};
use crate::ids_codec::parse_card_id;
use crate::ids_codec::parse_player_id;
use crate::ids_codec::stack_id_str;
use crate::prompt::{PlayerAction, PromptInput, TargetAnyChoice};

use super::{PromptAgent, Responder};

pub(super) fn choose_target_player<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid: &[PlayerId],
    source: Option<CardId>,
    hostile: bool,
    intent: TargetingIntent,
) -> Option<PlayerId> {
    let valid_player_ids = PromptAgent::<T>::player_ids(valid);
    agent.send_prompt(
        PromptInput::ChooseTargetPlayer(
            manabrew_protocol::prompts::choose_target_player::ChooseTargetPlayerInput {
                valid_player_ids,
                hostile,
                intent,
                min_targets: 1,
                max_targets: 1,
                chosen_targets: 0,
            },
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
    let valid_card_ids = PromptAgent::<T>::card_ids(valid);
    agent.send_prompt(
        PromptInput::ChooseTargetCard(
            manabrew_protocol::prompts::choose_target_card::ChooseTargetCardInput {
                valid_card_ids,
                hostile,
                intent,
                min_targets: 1,
                max_targets: 1,
                chosen_targets: 0,
            },
        ),
        source,
    );
    agent.recv_card_choice_or_first(valid)
}

pub(super) fn choose_target_card_from_zone<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    zone: ZoneType,
    valid: &[CardId],
    source: Option<CardId>,
    _hostile: bool,
    intent: TargetingIntent,
) -> Option<CardId> {
    let valid_card_ids = PromptAgent::<T>::card_ids(valid);
    let view = agent.view();

    // Build the list of cards in the specified zone
    let zone_cards: Vec<CardDto> = match zone {
        ZoneType::Graveyard => view
            .players
            .iter()
            .flat_map(|p| p.graveyard.iter())
            .filter(|c| valid_card_ids.contains(&c.id))
            .cloned()
            .collect(),
        ZoneType::Exile => view
            .players
            .iter()
            .flat_map(|p| p.exile.iter())
            .filter(|c| valid_card_ids.contains(&c.id))
            .cloned()
            .collect(),
        ZoneType::Hand => view
            .players
            .iter()
            .flat_map(|p| p.hand.iter())
            .filter(|c| valid_card_ids.contains(&c.id))
            .cloned()
            .collect(),
        _ => vec![],
    };

    agent.send_prompt(
        PromptInput::ChooseTargetCardFromZone(
            manabrew_protocol::prompts::choose_target_card_from_zone::ChooseTargetCardFromZoneInput {
                valid_card_ids,
                zone: format!("{:?}", zone),
                zone_cards,
                intent,
                min_targets: 1,
                max_targets: 1,
                chosen_targets: 0,
            },
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
    let valid_player_ids = PromptAgent::<T>::player_ids(valid_players);
    let valid_card_ids = PromptAgent::<T>::card_ids(valid_cards);
    agent.send_prompt(
        PromptInput::ChooseTargetAny(
            manabrew_protocol::prompts::choose_target_any::ChooseTargetAnyInput {
                valid_player_ids,
                valid_card_ids,
                hostile,
                intent,
                min_targets: 1,
                max_targets: 1,
                chosen_targets: 0,
            },
        ),
        source,
    );
    match agent.recv_action() {
        PlayerAction::TargetAny { target } => match target {
            TargetAnyChoice::Player { player_id } => parse_player_id(&player_id)
                .map(TargetChoice::Player)
                .unwrap_or(TargetChoice::None),
            TargetAnyChoice::Card { card_id } => parse_card_id(&card_id)
                .map(TargetChoice::Card)
                .unwrap_or(TargetChoice::None),
            TargetAnyChoice::None => TargetChoice::None,
        },
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
    let valid_spell_ids: Vec<String> = valid.iter().map(|&id| stack_id_str(id)).collect();
    agent.send_prompt(
        PromptInput::ChooseTargetSpell(
            manabrew_protocol::prompts::choose_target_spell::ChooseTargetSpellInput {
                valid_spell_ids,
                intent: TargetingIntent::Counter,
                min_targets: 1,
                max_targets: 1,
                chosen_targets: 0,
            },
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
    let valid_card_ids = PromptAgent::<T>::card_ids(valid);
    agent.send_prompt(
        PromptInput::ChooseTargetCard(
            manabrew_protocol::prompts::choose_target_card::ChooseTargetCardInput {
                valid_card_ids,
                hostile: true,
                intent: TargetingIntent::Sacrifice,
                min_targets: 1,
                max_targets: 1,
                chosen_targets: 0,
            },
        ),
        source,
    );
    agent.recv_card_choice_or_first(valid)
}
