use manabrew_engine::agent::{BinaryChoiceKind, GameEntity, RollSwapChoice};
use manabrew_engine::card::CounterType;
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::spellability::SpellAbility;

use manabrew_engine::game::GameState;

use crate::game_view_dto::{card_to_dto, CardDto, TargetingIntent};
use crate::ids_codec::{card_id_str, parse_card_id};
use crate::prompt::*;

use super::{PromptAgent, Responder};

fn card_choice_presentation(
    title: &str,
    description: Option<String>,
    source: Option<CardId>,
) -> PromptPresentation {
    PromptPresentation {
        title: title.to_string(),
        description,
        text: None,
        source_card_id: source.map(card_id_str),
        targets: Vec::new(),
    }
}

fn zone_cards_for<T: Responder>(agent: &mut PromptAgent<T>, valid: &[CardId]) -> Vec<CardDto> {
    let valid_card_ids = PromptAgent::<T>::card_ids(valid);
    let view = agent.view();
    let all_cards: Vec<&CardDto> = view.all_zone_cards().collect();
    valid_card_ids
        .iter()
        .filter_map(|id| all_cards.iter().find(|c| c.id == *id).map(|c| (*c).clone()))
        .collect()
}

fn send_selection<T: Responder>(
    agent: &mut PromptAgent<T>,
    title: &str,
    description: Option<String>,
    options: Vec<String>,
    min: usize,
    max: usize,
    source: Option<CardId>,
) {
    agent.send_prompt(
        PromptInput::ChooseFromSelection(ChooseFromSelectionInput {
            presentation: PromptPresentation {
                title: title.to_string(),
                description,
                text: None,
                source_card_id: source.map(card_id_str),
                targets: Vec::new(),
            },
            options,
            min_choices: min,
            max_choices: max,
        }),
        source,
    );
}

fn recv_selection<T: Responder>(agent: &mut PromptAgent<T>) -> Option<Vec<usize>> {
    match agent.recv_action() {
        PromptOutput::ChooseFromSelection(ChooseFromSelectionOutput::SelectionDecision {
            chosen_indices,
        }) => Some(chosen_indices),
        _ => None,
    }
}

fn card_name<T: Responder>(agent: &PromptAgent<T>, card_id: CardId) -> String {
    let id = crate::ids_codec::card_id_str(card_id);
    agent
        .latest_view
        .as_ref()
        .and_then(|view| {
            view.all_zone_cards()
                .find(|card| card.id == id)
                .map(|card| card.name.clone())
        })
        .unwrap_or(id)
}

fn player_name<T: Responder>(agent: &PromptAgent<T>, player_id: PlayerId) -> String {
    let id = crate::ids_codec::player_id_str(player_id);
    agent
        .latest_view
        .as_ref()
        .and_then(|view| view.players.iter().find(|player| player.id == id))
        .map(|player| player.name.clone())
        .unwrap_or(id)
}

fn entity_label<T: Responder>(agent: &PromptAgent<T>, entity: GameEntity) -> String {
    match entity {
        GameEntity::Card(card_id) => card_name(agent, card_id),
        GameEntity::Player(player_id) => player_name(agent, player_id),
    }
}

fn ability_label<T: Responder>(
    agent: &PromptAgent<T>,
    ability: &SpellAbility,
    index: usize,
) -> String {
    let source_name = ability.source.map(|cid| card_name(agent, cid));
    let description = ability
        .ir
        .spell_description_text
        .as_deref()
        .or(ability.ir.precost_desc.as_deref())
        .or(ability.ir.stack_description_text.as_deref())
        .or(ability.ir.sp_desc_text.as_deref())
        .unwrap_or(ability.ability_text.as_str());
    match source_name {
        Some(name) if !description.is_empty() => description.replace("CARDNAME", &name),
        Some(name) => name,
        None if !description.is_empty() => description.to_string(),
        None => format!("Ability {}", index + 1),
    }
}

fn counter_type_label(counter_type: &CounterType) -> String {
    match counter_type {
        CounterType::P1P1 => "+1/+1".to_string(),
        CounterType::M1M1 => "-1/-1".to_string(),
        CounterType::Named(name) => name.clone(),
        other => format!("{other:?}"),
    }
}

pub(super) fn mulligan_decision<T: Responder>(
    agent: &mut PromptAgent<T>,
    player: PlayerId,
    hand: &[CardId],
    mulligan_count: u32,
) -> bool {
    mulligan_decision_send(agent, player, hand, mulligan_count);
    mulligan_decision_recv(agent, player, hand, mulligan_count)
}

pub(super) fn mulligan_decision_send<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    hand: &[CardId],
    mulligan_count: u32,
) {
    let hand_card_ids = PromptAgent::<T>::card_ids(hand);
    agent.send_prompt(
        PromptInput::Mulligan(manabrew_protocol::prompts::mulligan::MulliganInput {
            hand_card_ids,
            mulligan_count,
        }),
        None,
    );
}

pub(super) fn mulligan_decision_recv<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    _hand: &[CardId],
    _mulligan_count: u32,
) -> bool {
    // The engine sends exactly one Mulligan prompt before this recv;
    // any other action is a contract violation. Concede short-circuits
    // so a torn-down session exits cleanly.
    match agent.recv_action() {
        PromptOutput::Mulligan(MulliganOutput::MulliganDecision { keep }) => keep,
        PromptOutput::ChooseAction(ChooseActionOutput::Concede) => true,
        other => panic!("mulligan_decision_recv expected MulliganDecision, got {other:?}"),
    }
}

pub(super) fn choose_cards_to_bottom<T: Responder>(
    agent: &mut PromptAgent<T>,
    player: PlayerId,
    hand: &[CardId],
    count: usize,
) -> Vec<CardId> {
    choose_cards_to_bottom_send(agent, player, hand, count);
    choose_cards_to_bottom_recv(agent, player, hand, count)
}

pub(super) fn choose_cards_to_bottom_send<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    hand: &[CardId],
    count: usize,
) {
    let view = agent.view();
    let hand_card_ids = PromptAgent::<T>::card_ids(hand);
    let cards: Vec<CardDto> = hand
        .iter()
        .filter_map(|&cid| {
            let id_str = crate::ids_codec::card_id_str(cid);
            view.all_zone_cards().find(|c| c.id == id_str).cloned()
        })
        .collect();
    agent.send_prompt(
        PromptInput::MulliganPutBack(
            manabrew_protocol::prompts::mulligan_put_back::MulliganPutBackInput {
                hand_card_ids,
                cards,
                count,
            },
        ),
        None,
    );
}

pub(super) fn choose_cards_to_bottom_recv<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    hand: &[CardId],
    count: usize,
) -> Vec<CardId> {
    match agent.recv_action() {
        PromptOutput::MulliganPutBack(MulliganPutBackOutput::MulliganPutBackDecision {
            card_ids,
        }) => card_ids.iter().filter_map(|s| parse_card_id(s)).collect(),
        _ => hand.iter().copied().take(count).collect(),
    }
}

pub(super) fn choose_mode<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    descriptions: &[String],
    min: usize,
    max: usize,
    source_card_id: Option<CardId>,
) -> Vec<usize> {
    send_selection(
        agent,
        "Choose Mode",
        None,
        descriptions.to_vec(),
        min,
        max,
        source_card_id,
    );
    recv_selection(agent).unwrap_or_else(|| (0..min.min(descriptions.len())).collect())
}

pub(super) fn choose_spell_abilities_for_effect<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    abilities: &[SpellAbility],
    num: usize,
) -> Vec<usize> {
    if abilities.is_empty() || num == 0 {
        return Vec::new();
    }
    let options: Vec<String> = abilities
        .iter()
        .enumerate()
        .map(|(index, ability)| ability_label(agent, ability, index))
        .collect();
    let source_card_id = abilities.first().and_then(|ability| ability.source);
    send_selection(
        agent,
        "Choose ability",
        None,
        options,
        num.min(abilities.len()),
        num.min(abilities.len()),
        source_card_id,
    );
    match recv_selection(agent) {
        Some(chosen_indices) => chosen_indices
            .into_iter()
            .filter(|index| *index < abilities.len())
            .take(num)
            .collect(),
        None => (0..num.min(abilities.len())).collect(),
    }
}

pub(super) fn get_ability_to_play<T: Responder>(
    agent: &mut PromptAgent<T>,
    player: PlayerId,
    abilities: &[SpellAbility],
) -> Option<usize> {
    choose_spell_abilities_for_effect(agent, player, abilities, 1)
        .into_iter()
        .next()
}

pub(super) fn choose_single_entity_for_effect<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid: &[GameEntity],
    is_optional: bool,
) -> Option<GameEntity> {
    if valid.is_empty() {
        return None;
    }
    if valid.len() == 1 && !is_optional {
        return valid.first().copied();
    }
    if valid
        .iter()
        .all(|entity| matches!(entity, GameEntity::Card(_)))
    {
        let cards: Vec<CardId> = valid
            .iter()
            .filter_map(|entity| match entity {
                GameEntity::Card(card_id) => Some(*card_id),
                GameEntity::Player(_) => None,
            })
            .collect();
        return choose_cards_for_effect(agent, _player, &cards, usize::from(!is_optional), 1)
            .into_iter()
            .next()
            .map(GameEntity::Card);
    }
    if valid
        .iter()
        .all(|entity| matches!(entity, GameEntity::Player(_)))
    {
        let players: Vec<PlayerId> = valid
            .iter()
            .filter_map(|entity| match entity {
                GameEntity::Player(player_id) => Some(*player_id),
                GameEntity::Card(_) => None,
            })
            .collect();
        let chosen = super::targeting::choose_target_player(
            agent,
            _player,
            &players,
            None,
            false,
            TargetingIntent::Hostile,
        );
        return chosen.map(GameEntity::Player).or_else(|| {
            if is_optional {
                None
            } else {
                valid.first().copied()
            }
        });
    }

    let options: Vec<String> = valid
        .iter()
        .map(|entity| entity_label(agent, *entity))
        .collect();
    send_selection(
        agent,
        "Choose entity",
        None,
        options,
        usize::from(!is_optional),
        1,
        None,
    );
    match recv_selection(agent) {
        Some(chosen_indices) => chosen_indices
            .first()
            .and_then(|index| valid.get(*index).copied()),
        None => {
            if is_optional {
                None
            } else {
                valid.first().copied()
            }
        }
    }
}

pub(super) fn choose_entities_for_effect<T: Responder>(
    agent: &mut PromptAgent<T>,
    player: PlayerId,
    valid: &[GameEntity],
    min: usize,
    max: usize,
) -> Vec<GameEntity> {
    if valid.is_empty() || max == 0 {
        return Vec::new();
    }
    if valid
        .iter()
        .all(|entity| matches!(entity, GameEntity::Card(_)))
    {
        let cards: Vec<CardId> = valid
            .iter()
            .filter_map(|entity| match entity {
                GameEntity::Card(card_id) => Some(*card_id),
                GameEntity::Player(_) => None,
            })
            .collect();
        return choose_cards_for_effect(agent, player, &cards, min, max)
            .into_iter()
            .map(GameEntity::Card)
            .collect();
    }

    let options: Vec<String> = valid
        .iter()
        .map(|entity| entity_label(agent, *entity))
        .collect();
    send_selection(
        agent,
        "Choose entities",
        None,
        options,
        min.min(valid.len()),
        max.min(valid.len()),
        None,
    );
    match recv_selection(agent) {
        Some(chosen_indices) => chosen_indices
            .into_iter()
            .filter_map(|index| valid.get(index).copied())
            .take(max)
            .collect(),
        None => valid.iter().copied().take(max).collect(),
    }
}

fn send_boolean<T: Responder>(
    agent: &mut PromptAgent<T>,
    title: &str,
    confirm_label: &str,
    deny_label: &str,
    source: Option<CardId>,
    default: bool,
) -> bool {
    agent.send_prompt(
        PromptInput::ChooseBoolean(
            manabrew_protocol::prompts::choose_boolean::ChooseBooleanInput {
                presentation: PromptPresentation {
                    title: title.to_string(),
                    description: None,
                    text: None,
                    source_card_id: source.map(card_id_str),
                    targets: Vec::new(),
                },
                confirm_label: confirm_label.to_string(),
                deny_label: deny_label.to_string(),
            },
        ),
        source,
    );
    match agent.recv_action() {
        PromptOutput::ChooseBoolean(ChooseBooleanOutput::Decision { value }) => value,
        _ => default,
    }
}

pub(super) fn choose_optional_trigger<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    description: &str,
    source: Option<CardId>,
    _api: Option<manabrew_engine::ability::api_type::ApiType>,
) -> bool {
    send_boolean(agent, description, "Accept", "Decline", source, true)
}

/// Ask the player whether to apply an optional replacement effect
/// (`Optional$ True`). Mirrors Java `PlayerController.confirmReplacementEffect`.
/// Defaults to `true` on malformed responses to match the base trait default.
pub(super) fn confirm_replacement_effect<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    question: &str,
    effect_description: &str,
    source: Option<CardId>,
) -> bool {
    let message = if effect_description.is_empty() {
        question.to_string()
    } else if question.is_empty() {
        effect_description.to_string()
    } else {
        format!("{question}\n{effect_description}")
    };
    send_boolean(agent, &message, "Accept", "Decline", source, true)
}

pub(super) fn confirm_action<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    _mode: Option<&str>,
    message: &str,
    options: &[String],
    source: Option<CardId>,
    _api: Option<manabrew_engine::ability::api_type::ApiType>,
) -> bool {
    let (deny, confirm) = match options {
        [deny, confirm, ..] => (deny.as_str(), confirm.as_str()),
        _ => ("Decline", "Accept"),
    };
    send_boolean(agent, message, confirm, deny, source, false)
}

pub(super) fn confirm_payment<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    _cost_kind: &str,
    message: &str,
    source: Option<CardId>,
    _api: Option<manabrew_engine::ability::api_type::ApiType>,
) -> bool {
    send_boolean(agent, message, "Pay", "Decline", source, false)
}

pub(super) fn reveal_cards<T: Responder>(
    agent: &mut PromptAgent<T>,
    game: &manabrew_engine::game::GameState,
    cards: &[CardId],
    zone: forge_foundation::ZoneType,
    owner: PlayerId,
    message_prefix: Option<&str>,
) {
    if cards.is_empty() {
        return;
    }
    let cards = cards
        .iter()
        .map(|&id| crate::game_view_dto::card_to_dto(game, id, &[], &zone.to_string()))
        .collect();
    let message = message_prefix.unwrap_or("Look at these cards").to_string();
    agent.send_prompt(
        PromptInput::RevealCards(manabrew_protocol::prompts::reveal_cards::RevealCardsInput {
            cards,
            zone: zone.to_string(),
            owner_player_id: crate::ids_codec::player_id_str(owner),
            message,
        }),
        None,
    );
    let _ = agent.recv_action();
}

pub(super) fn pay_cost_to_prevent_effect<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    cost_kind: &str,
    message: &str,
    source: Option<CardId>,
    _api: Option<manabrew_engine::ability::api_type::ApiType>,
    can_pay: bool,
    targets: &[GameEntity],
    effect_text: &str,
) -> bool {
    if !can_pay {
        return false;
    }
    let _ = cost_kind;
    agent.send_prompt(
        PromptInput::ChooseBoolean(
            manabrew_protocol::prompts::choose_boolean::ChooseBooleanInput {
                presentation: PromptPresentation {
                    title: message.to_string(),
                    description: None,
                    text: (!effect_text.trim().is_empty())
                        .then(|| format!("otherwise: \"{}\"", effect_text.trim())),
                    source_card_id: source.map(card_id_str),
                    targets: targets.iter().map(game_entity_to_target_ref).collect(),
                },
                confirm_label: "Pay".to_string(),
                deny_label: "Decline".to_string(),
            },
        ),
        source,
    );
    match agent.recv_action() {
        PromptOutput::ChooseBoolean(ChooseBooleanOutput::Decision { value }) => value,
        _ => false,
    }
}

fn game_entity_to_target_ref(entity: &GameEntity) -> TargetRef {
    match entity {
        GameEntity::Card(id) => TargetRef::Card {
            id: card_id_str(*id),
        },
        GameEntity::Player(id) => TargetRef::Player {
            id: crate::ids_codec::player_id_str(*id),
        },
    }
}

pub(super) fn choose_binary<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    question: &str,
    kind: BinaryChoiceKind,
    _default_choice: Option<bool>,
    source: Option<CardId>,
    _api: Option<manabrew_engine::ability::api_type::ApiType>,
) -> bool {
    let (left, right) = kind.labels();
    // `true` maps to Java's first (left) choice.
    send_boolean(agent, question, left, right, source, false)
}

pub(super) fn choose_color<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid_colors: &[String],
) -> Option<String> {
    agent.send_prompt(
        PromptInput::ChooseColor(manabrew_protocol::prompts::choose_color::ChooseColorInput {
            valid_colors: valid_colors.to_vec(),
        }),
        None,
    );
    match agent.recv_action() {
        PromptOutput::ChooseColor(ChooseColorOutput::ColorDecision { color }) => color,
        _ => valid_colors.first().cloned(),
    }
}

pub(super) fn choose_colors<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid_colors: &[String],
    min: usize,
    max: usize,
) -> Vec<String> {
    if valid_colors.is_empty() || max == 0 {
        return Vec::new();
    }
    send_selection(
        agent,
        "Choose colors",
        None,
        valid_colors.to_vec(),
        min.min(valid_colors.len()),
        max.min(valid_colors.len()),
        None,
    );
    match recv_selection(agent) {
        Some(chosen_indices) => chosen_indices
            .into_iter()
            .filter_map(|index| valid_colors.get(index).cloned())
            .take(max)
            .collect(),
        None => valid_colors
            .iter()
            .take(min.min(valid_colors.len()))
            .cloned()
            .collect(),
    }
}

pub(super) fn choose_type<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    type_category: &str,
    valid_types: &[String],
) -> Option<String> {
    agent.send_prompt(
        PromptInput::ChooseType(manabrew_protocol::prompts::choose_type::ChooseTypeInput {
            type_category: type_category.to_string(),
            valid_types: valid_types.to_vec(),
        }),
        None,
    );
    match agent.recv_action() {
        PromptOutput::ChooseType(ChooseTypeOutput::TypeDecision { chosen_type }) => chosen_type,
        _ => valid_types.first().cloned(),
    }
}

pub(super) fn choose_card_name<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid_names: &[String],
) -> Option<String> {
    agent.send_prompt(
        PromptInput::ChooseCardName(
            manabrew_protocol::prompts::choose_card_name::ChooseCardNameInput {
                valid_names: valid_names.to_vec(),
            },
        ),
        None,
    );
    match agent.recv_action() {
        PromptOutput::ChooseCardName(ChooseCardNameOutput::CardNameDecision { chosen_name }) => {
            chosen_name
        }
        _ => valid_names.first().cloned(),
    }
}

pub(super) fn choose_number_from_list<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    choices: &[i32],
    message: &str,
    source_card_id: Option<CardId>,
) -> Option<i32> {
    if choices.is_empty() {
        return None;
    }
    let title = if message.is_empty() {
        "Choose a number"
    } else {
        message
    };
    send_selection(
        agent,
        title,
        None,
        choices.iter().map(i32::to_string).collect(),
        1,
        1,
        source_card_id,
    );
    match recv_selection(agent) {
        Some(chosen_indices) => chosen_indices
            .first()
            .and_then(|index| choices.get(*index).copied()),
        None => choices.first().copied(),
    }
}

pub(super) fn choose_counter_type<T: Responder>(
    agent: &mut PromptAgent<T>,
    player: PlayerId,
    options: &[CounterType],
    prompt: &str,
) -> Option<CounterType> {
    let labels: Vec<String> = options.iter().map(counter_type_label).collect();
    let chosen = choose_type(agent, player, prompt, &labels)?;
    labels
        .iter()
        .position(|label| label == &chosen)
        .and_then(|index| options.get(index).cloned())
}

pub(super) fn choose_roll_to_ignore<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    rolls: &[i32],
    source: Option<CardId>,
) -> Option<i32> {
    if rolls.is_empty() {
        return None;
    }
    send_selection(
        agent,
        "Choose a roll to ignore",
        None,
        rolls.iter().map(i32::to_string).collect(),
        0,
        1,
        source,
    );
    match recv_selection(agent) {
        Some(chosen) => chosen.first().and_then(|index| rolls.get(*index).copied()),
        None => rolls.first().copied(),
    }
}

pub(super) fn choose_roll_to_swap<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    rolls: &[i32],
    source: Option<CardId>,
) -> Option<i32> {
    if rolls.is_empty() {
        return None;
    }
    send_selection(
        agent,
        "Choose a roll to swap",
        None,
        rolls.iter().map(i32::to_string).collect(),
        0,
        1,
        source,
    );
    match recv_selection(agent) {
        Some(chosen) => chosen.first().and_then(|index| rolls.get(*index).copied()),
        None => rolls.first().copied(),
    }
}

pub(super) fn choose_roll_to_modify<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    rolls: &[i32],
    source: Option<CardId>,
) -> Option<i32> {
    if rolls.is_empty() {
        return None;
    }
    send_selection(
        agent,
        "Choose a roll to modify",
        None,
        rolls.iter().map(i32::to_string).collect(),
        0,
        1,
        source,
    );
    match recv_selection(agent) {
        Some(chosen) => chosen.first().and_then(|index| rolls.get(*index).copied()),
        None => rolls.first().copied(),
    }
}

pub(super) fn choose_dice_to_reroll<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    rolls: &[i32],
    source: Option<CardId>,
) -> Vec<i32> {
    if rolls.is_empty() {
        return Vec::new();
    }
    send_selection(
        agent,
        "Choose dice to reroll",
        None,
        rolls.iter().map(i32::to_string).collect(),
        0,
        rolls.len(),
        source,
    );
    match recv_selection(agent) {
        Some(chosen) => chosen
            .into_iter()
            .filter_map(|index| rolls.get(index).copied())
            .collect(),
        None => Vec::new(),
    }
}

pub(super) fn choose_roll_swap_value<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    current_result: i32,
    power: i32,
    toughness: i32,
    source: Option<CardId>,
) -> Option<RollSwapChoice> {
    send_selection(
        agent,
        "Swap roll value",
        Some(format!("Current roll is {current_result}. Swap it with:")),
        vec![
            format!("Power ({power})"),
            format!("Toughness ({toughness})"),
        ],
        0,
        1,
        source,
    );
    match recv_selection(agent) {
        Some(chosen) => match chosen.first().copied() {
            Some(0) => Some(RollSwapChoice::Power),
            Some(1) => Some(RollSwapChoice::Toughness),
            _ => None,
        },
        None => Some(RollSwapChoice::Power),
    }
}

pub(super) fn flip_coin_call<T: Responder>(agent: &mut PromptAgent<T>, player: PlayerId) -> bool {
    choose_binary(
        agent,
        player,
        "Choose heads or tails",
        BinaryChoiceKind::HeadsOrTails,
        Some(true),
        None,
        None,
    )
}

pub(super) fn choose_number<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    source: Option<CardId>,
    title: &str,
    description: Option<&str>,
    min: i32,
    max: i32,
) -> Option<i32> {
    agent.send_prompt(
        PromptInput::ChooseNumber(
            manabrew_protocol::prompts::choose_number::ChooseNumberInput {
                presentation: PromptPresentation {
                    title: title.to_string(),
                    description: description.map(str::to_string),
                    text: None,
                    source_card_id: source.map(card_id_str),
                    targets: Vec::new(),
                },
                min,
                max,
            },
        ),
        source,
    );
    match agent.recv_action() {
        PromptOutput::ChooseNumber(ChooseNumberOutput::NumberDecision { chosen_number }) => {
            chosen_number
        }
        _ => Some(min),
    }
}

pub(super) fn choose_discard<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    hand: &[CardId],
    num: usize,
) -> Vec<CardId> {
    let cards = zone_cards_for(agent, hand);
    agent.send_prompt(
        PromptInput::ChooseCards(manabrew_protocol::prompts::choose_cards::ChooseCardsInput {
            presentation: card_choice_presentation("Discard", None, None),
            cards,
            min: num,
            max: num,
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
        _ => hand.iter().copied().take(num).collect(),
    }
}

pub(super) fn choose_discard_any_number<T: Responder>(
    agent: &mut PromptAgent<T>,
    player: PlayerId,
    hand: &[CardId],
    min: usize,
    max: usize,
) -> Vec<CardId> {
    choose_cards_for_effect(agent, player, hand, min, max)
}

pub(super) fn choose_legend_keep<T: Responder>(
    agent: &mut PromptAgent<T>,
    player: PlayerId,
    duplicates: &[CardId],
) -> CardId {
    choose_cards_for_effect(agent, player, duplicates, 1, 1)
        .into_iter()
        .next()
        .unwrap_or(duplicates[0])
}

pub(super) fn choose_cards_for_effect<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid: &[CardId],
    min: usize,
    max: usize,
) -> Vec<CardId> {
    let cards = zone_cards_for(agent, valid);
    agent.send_prompt(
        PromptInput::ChooseCards(manabrew_protocol::prompts::choose_cards::ChooseCardsInput {
            presentation: card_choice_presentation("Choose cards", None, None),
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

pub(super) fn choose_single_card_for_zone_change<T: Responder>(
    agent: &mut PromptAgent<T>,
    game: &GameState,
    _player: PlayerId,
    valid: &[CardId],
    select_prompt: &str,
    is_optional: bool,
) -> Option<CardId> {
    let view = agent.view();

    let all_cards: Vec<&CardDto> = view.all_zone_cards().collect();
    let mut zone_cards: Vec<CardDto> = valid
        .iter()
        .map(|&cid| {
            let id = crate::ids_codec::card_id_str(cid);
            all_cards
                .iter()
                .find(|c| c.id == id)
                .map(|c| (*c).clone())
                .unwrap_or_else(|| card_to_dto(game, cid, &[], "library"))
        })
        .collect();
    // Deduplicate
    let mut seen = std::collections::HashSet::new();
    zone_cards.retain(|c| seen.insert(c.id.clone()));

    let min_choices = if is_optional { 0 } else { 1 };
    agent.send_prompt(
        PromptInput::ChooseCards(manabrew_protocol::prompts::choose_cards::ChooseCardsInput {
            presentation: card_choice_presentation(select_prompt, None, None),
            cards: zone_cards,
            min: min_choices,
            max: 1,
        }),
        None,
    );
    match agent.recv_action() {
        PromptOutput::ChooseCards(ChooseCardsOutput::ChooseCardsDecision { chosen_card_ids }) => {
            chosen_card_ids.first().and_then(|id| parse_card_id(id))
        }
        _ => {
            if is_optional {
                None
            } else {
                valid.first().copied()
            }
        }
    }
}

pub(super) fn choose_cards_for_zone_change<T: Responder>(
    agent: &mut PromptAgent<T>,
    game: &GameState,
    _player: PlayerId,
    valid: &[CardId],
    min: usize,
    max: usize,
    select_prompt: &str,
) -> Vec<CardId> {
    let view = agent.view();

    let all_cards: Vec<&CardDto> = view.all_zone_cards().collect();
    let mut zone_cards: Vec<CardDto> = valid
        .iter()
        .map(|&cid| {
            let id = crate::ids_codec::card_id_str(cid);
            all_cards
                .iter()
                .find(|c| c.id == id)
                .map(|c| (*c).clone())
                .unwrap_or_else(|| card_to_dto(game, cid, &[], "library"))
        })
        .collect();
    let mut seen = std::collections::HashSet::new();
    zone_cards.retain(|c| seen.insert(c.id.clone()));

    agent.send_prompt(
        PromptInput::ChooseCards(manabrew_protocol::prompts::choose_cards::ChooseCardsInput {
            presentation: card_choice_presentation(select_prompt, None, None),
            cards: zone_cards,
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

pub(super) fn help_pay_assist<T: Responder>(
    agent: &mut PromptAgent<T>,
    player: PlayerId,
    card_name: &str,
    max_generic: u32,
) -> u32 {
    let description = format!("Pay generic mana to help cast {card_name}.");
    choose_number(
        agent,
        player,
        None,
        "Assist",
        Some(&description),
        0,
        max_generic as i32,
    )
    .unwrap_or(0)
    .clamp(0, max_generic as i32) as u32
}

pub(super) fn choose_random_discard<T: Responder>(
    _agent: &mut PromptAgent<T>,
    _player: PlayerId,
    hand: &[CardId],
    num: usize,
) -> Vec<CardId> {
    use rand::seq::SliceRandom;
    let mut v = hand.to_vec();
    v.shuffle(&mut rand::thread_rng());
    v.truncate(num);
    v
}

pub(super) fn choose_land_or_spell<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
) -> Option<bool> {
    send_selection(
        agent,
        "Choose land or spell",
        None,
        vec!["Land".to_string(), "Spell".to_string()],
        1,
        1,
        None,
    );
    match recv_selection(agent) {
        Some(chosen_indices) => match chosen_indices.first().copied() {
            Some(0) => Some(true),
            Some(1) => Some(false),
            _ => None,
        },
        None => None,
    }
}

/// Choose which replacement effect to apply when multiple effects match.
/// Reuses ChooseFromSelection — structurally identical (pick one from a list).
pub(super) fn choose_single_replacement_effect<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    descriptions: &[String],
) -> usize {
    if descriptions.is_empty() {
        return 0;
    }
    send_selection(
        agent,
        "Replacement Effect",
        None,
        descriptions.to_vec(),
        1,
        1,
        None,
    );
    recv_selection(agent)
        .and_then(|chosen| chosen.first().copied())
        .unwrap_or(0)
}
