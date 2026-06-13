use forge_engine_core::agent::{BinaryChoiceKind, GameEntity, RollSwapChoice};
use forge_engine_core::card::CounterType;
use forge_engine_core::ids::{CardId, PlayerId};
use forge_engine_core::spellability::SpellAbility;

use crate::game_view_dto::{CardDto, TargetingIntent};
use crate::ids_codec::parse_card_id;
use crate::prompt::{AgentPromptInner, PlayerAction};

use super::{PromptAgent, Responder};

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
        AgentPromptInner::Mulligan {
            hand_card_ids,
            mulligan_count,
        },
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
        PlayerAction::MulliganDecision { keep } => keep,
        PlayerAction::Concede => true,
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
        AgentPromptInner::MulliganPutBack {
            hand_card_ids,
            cards,
            count,
        },
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
        PlayerAction::MulliganPutBackDecision { card_ids } => {
            card_ids.iter().filter_map(|s| parse_card_id(s)).collect()
        }
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
    agent.send_prompt(
        AgentPromptInner::ChooseMode {
            options: descriptions.to_vec(),
            min_choices: min,
            max_choices: max,
            source_card_name: None,
        },
        source_card_id,
    );
    match agent.recv_action() {
        PlayerAction::ModeDecision { chosen_indices } => chosen_indices,
        _ => (0..min.min(descriptions.len())).collect(),
    }
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
    agent.send_prompt(
        AgentPromptInner::ChooseMode {
            options,
            min_choices: num.min(abilities.len()),
            max_choices: num.min(abilities.len()),
            source_card_name: None,
        },
        source_card_id,
    );
    match agent.recv_action() {
        PlayerAction::ModeDecision { chosen_indices } => chosen_indices
            .into_iter()
            .filter(|index| *index < abilities.len())
            .take(num)
            .collect(),
        _ => (0..num.min(abilities.len())).collect(),
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
    agent.send_prompt(
        AgentPromptInner::ChooseMode {
            options,
            min_choices: usize::from(!is_optional),
            max_choices: 1,
            source_card_name: Some("Choose entity".to_string()),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::ModeDecision { chosen_indices } => chosen_indices
            .first()
            .and_then(|index| valid.get(*index).copied()),
        _ => {
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
    agent.send_prompt(
        AgentPromptInner::ChooseMode {
            options,
            min_choices: min.min(valid.len()),
            max_choices: max.min(valid.len()),
            source_card_name: Some("Choose entities".to_string()),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::ModeDecision { chosen_indices } => chosen_indices
            .into_iter()
            .filter_map(|index| valid.get(index).copied())
            .take(max)
            .collect(),
        _ => valid.iter().copied().take(max).collect(),
    }
}

pub(super) fn choose_optional_trigger<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    description: &str,
    source: Option<CardId>,
    _api: Option<forge_engine_core::ability::api_type::ApiType>,
) -> bool {
    agent.send_prompt(
        AgentPromptInner::ChooseOptionalTrigger {
            description: description.to_string(),
            cards: Vec::new(),
            prompt_kind: Some("optional_trigger".to_string()),
            option_labels: Some(vec!["Decline".to_string(), "Accept".to_string()]),
            mode: None,
            api: None,
        },
        source,
    );
    match agent.recv_action() {
        PlayerAction::OptionalTriggerDecision { accept } => accept,
        _ => true,
    }
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
    agent.send_prompt(
        AgentPromptInner::ChooseOptionalTrigger {
            description: message,
            cards: Vec::new(),
            prompt_kind: Some("confirm_replacement_effect".to_string()),
            option_labels: Some(vec!["Decline".to_string(), "Accept".to_string()]),
            mode: None,
            api: None,
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::OptionalTriggerDecision { accept } => accept,
        _ => true,
    }
}

pub(super) fn confirm_action<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    mode: Option<&str>,
    message: &str,
    options: &[String],
    source: Option<CardId>,
    api: Option<forge_engine_core::ability::api_type::ApiType>,
) -> bool {
    // Reuse the existing optional-trigger modal plumbing for generic confirms.
    let option_labels = if options.is_empty() {
        vec!["Decline".to_string(), "Accept".to_string()]
    } else {
        options.to_vec()
    };
    agent.send_prompt(
        AgentPromptInner::ChooseOptionalTrigger {
            description: message.to_string(),
            cards: Vec::new(),
            prompt_kind: Some("confirm_action".to_string()),
            option_labels: Some(option_labels),
            mode: mode.map(String::from),
            api: api.map(|a| a.name().to_string()),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::OptionalTriggerDecision { accept } => accept,
        _ => false,
    }
}

pub(super) fn confirm_payment<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    cost_kind: &str,
    message: &str,
    source: Option<CardId>,
    api: Option<forge_engine_core::ability::api_type::ApiType>,
) -> bool {
    agent.send_prompt(
        AgentPromptInner::ChooseOptionalTrigger {
            description: message.to_string(),
            cards: Vec::new(),
            prompt_kind: Some("confirm_payment".to_string()),
            option_labels: Some(vec!["Decline".to_string(), "Accept".to_string()]),
            mode: Some(cost_kind.to_string()),
            api: api.map(|a| a.name().to_string()),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::OptionalTriggerDecision { accept } => accept,
        _ => false,
    }
}

pub(super) fn reveal_cards<T: Responder>(
    agent: &mut PromptAgent<T>,
    game: &forge_engine_core::game::GameState,
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
        AgentPromptInner::RevealCards {
            cards,
            zone: zone.to_string(),
            owner_player_id: crate::ids_codec::player_id_str(owner),
            message,
        },
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
    api: Option<forge_engine_core::ability::api_type::ApiType>,
    can_pay: bool,
) -> bool {
    if !can_pay {
        return false;
    }
    agent.send_prompt(
        AgentPromptInner::PayCostToPreventEffect {
            description: message.to_string(),
            cost_kind: cost_kind.to_string(),
            api: api.map(|a| a.name().to_string()),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::PayCostToPreventEffectDecision { accept } => accept,
        _ => false,
    }
}

pub(super) fn choose_binary<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    question: &str,
    kind: BinaryChoiceKind,
    _default_choice: Option<bool>,
    source: Option<CardId>,
    api: Option<forge_engine_core::ability::api_type::ApiType>,
) -> bool {
    let (left, right) = kind.labels();
    // In this modal pipeline, `accept=true` means "second button";
    // reverse labels so `true` still maps to Java's first (left) choice.
    agent.send_prompt(
        AgentPromptInner::ChooseOptionalTrigger {
            description: question.to_string(),
            cards: Vec::new(),
            prompt_kind: Some("choose_binary".to_string()),
            option_labels: Some(vec![right.to_string(), left.to_string()]),
            mode: Some(kind.as_str().to_string()),
            api: api.map(|a| a.name().to_string()),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::OptionalTriggerDecision { accept } => accept,
        _ => false,
    }
}

pub(super) fn choose_color<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid_colors: &[String],
) -> Option<String> {
    if let Some(pending) = agent.pending_mana_color.take() {
        if let Some(matched) = super::find_matching_color(&pending, valid_colors.iter()) {
            return Some(matched);
        }
    }

    agent.send_prompt(
        AgentPromptInner::ChooseColor {
            valid_colors: valid_colors.to_vec(),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::ColorDecision { color } => color,
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
    agent.send_prompt(
        AgentPromptInner::ChooseMode {
            options: valid_colors.to_vec(),
            min_choices: min.min(valid_colors.len()),
            max_choices: max.min(valid_colors.len()),
            source_card_name: Some("Choose colors".to_string()),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::ModeDecision { chosen_indices } => chosen_indices
            .into_iter()
            .filter_map(|index| valid_colors.get(index).cloned())
            .take(max)
            .collect(),
        _ => valid_colors
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
        AgentPromptInner::ChooseType {
            type_category: type_category.to_string(),
            valid_types: valid_types.to_vec(),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::TypeDecision { chosen_type } => chosen_type,
        _ => valid_types.first().cloned(),
    }
}

pub(super) fn choose_card_name<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid_names: &[String],
) -> Option<String> {
    agent.send_prompt(
        AgentPromptInner::ChooseCardName {
            valid_names: valid_names.to_vec(),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::CardNameDecision { chosen_name } => chosen_name,
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
    agent.send_prompt(
        AgentPromptInner::ChooseMode {
            options: choices.iter().map(i32::to_string).collect(),
            min_choices: 1,
            max_choices: 1,
            source_card_name: if source_card_id.is_some() || message.is_empty() {
                None
            } else {
                Some(message.to_string())
            },
        },
        source_card_id,
    );
    match agent.recv_action() {
        PlayerAction::ModeDecision { chosen_indices } => chosen_indices
            .first()
            .and_then(|index| choices.get(*index).copied()),
        PlayerAction::NumberDecision { chosen_number } => {
            chosen_number.filter(|number| choices.contains(number))
        }
        _ => choices.first().copied(),
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
    agent.send_prompt(
        AgentPromptInner::ChooseRollToIgnore {
            rolls: rolls.to_vec(),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::RollToIgnoreDecision { roll } => roll.filter(|r| rolls.contains(r)),
        _ => rolls.first().copied(),
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
    agent.send_prompt(
        AgentPromptInner::ChooseRollToSwap {
            rolls: rolls.to_vec(),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::RollToSwapDecision { roll } => roll.filter(|r| rolls.contains(r)),
        _ => rolls.first().copied(),
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
    agent.send_prompt(
        AgentPromptInner::ChooseRollToModify {
            rolls: rolls.to_vec(),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::RollToModifyDecision { roll } => roll.filter(|r| rolls.contains(r)),
        _ => rolls.first().copied(),
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
    agent.send_prompt(
        AgentPromptInner::ChooseDiceToReroll {
            rolls: rolls.to_vec(),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::DiceToRerollDecision { rolls: chosen } => {
            chosen.into_iter().filter(|r| rolls.contains(r)).collect()
        }
        _ => Vec::new(),
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
    agent.send_prompt(
        AgentPromptInner::ChooseRollSwapValue {
            current_result,
            power,
            toughness,
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::RollSwapValueDecision { choice } => match choice.as_deref() {
            Some("toughness") => Some(RollSwapChoice::Toughness),
            Some("power") => Some(RollSwapChoice::Power),
            _ => None,
        },
        _ => Some(RollSwapChoice::Power),
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

pub(super) fn choose_x_value<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    max_x: u32,
    source: Option<CardId>,
) -> u32 {
    agent.send_prompt(
        AgentPromptInner::ChooseNumber {
            min: 0,
            max: max_x as i32,
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::NumberDecision { chosen_number } => {
            chosen_number.unwrap_or(max_x as i32).max(0) as u32
        }
        _ => max_x,
    }
}

pub(super) fn choose_number<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    min: i32,
    max: i32,
) -> Option<i32> {
    agent.send_prompt(AgentPromptInner::ChooseNumber { min, max }, None);
    match agent.recv_action() {
        PlayerAction::NumberDecision { chosen_number } => chosen_number,
        _ => Some(min),
    }
}

pub(super) fn announce_requirements<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    min: i32,
    max: i32,
    source: Option<CardId>,
) -> Option<i32> {
    agent.send_prompt(AgentPromptInner::ChooseNumber { min, max }, source);
    match agent.recv_action() {
        PlayerAction::NumberDecision { chosen_number } => chosen_number,
        _ => Some(min),
    }
}

pub(super) fn choose_discard<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    hand: &[CardId],
    num: usize,
) -> Vec<CardId> {
    let hand_card_ids = PromptAgent::<T>::card_ids(hand);
    agent.send_prompt(
        AgentPromptInner::ChooseDiscard {
            hand_card_ids,
            num_to_discard: num,
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::DiscardDecision { discarded_card_ids } => discarded_card_ids
            .iter()
            .filter_map(|id| parse_card_id(id))
            .collect(),
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
    let valid_card_ids = PromptAgent::<T>::card_ids(valid);
    let view = agent.view();

    // Build zone_cards from the snapshot view's zones (find matching DTOs)
    let all_cards: Vec<&CardDto> = view.all_zone_cards().collect();
    let zone_cards: Vec<CardDto> = valid_card_ids
        .iter()
        .filter_map(|id| all_cards.iter().find(|c| c.id == *id).map(|c| (*c).clone()))
        .collect();

    agent.send_prompt(
        AgentPromptInner::ChooseCardsForEffect {
            valid_card_ids,
            zone_cards,
            min_choices: min,
            max_choices: max,
            source_card_name: None,
            optional: false,
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::ChooseCardsDecision { chosen_card_ids } => chosen_card_ids
            .iter()
            .filter_map(|id| parse_card_id(id))
            .collect(),
        _ => valid.iter().copied().take(max).collect(),
    }
}

pub(super) fn choose_single_card_for_zone_change<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid: &[CardId],
    select_prompt: &str,
    is_optional: bool,
) -> Option<CardId> {
    let valid_card_ids = PromptAgent::<T>::card_ids(valid);
    let view = agent.view();

    // Build zone_cards from all known zones + peeked library cards
    let peeked = std::mem::take(&mut agent.peeked_library_cards);
    let all_cards: Vec<&CardDto> = view.all_zone_cards().collect();
    let mut zone_cards: Vec<CardDto> = valid_card_ids
        .iter()
        .filter_map(|id| {
            all_cards
                .iter()
                .find(|c| c.id == *id)
                .map(|c| (*c).clone())
                .or_else(|| peeked.iter().find(|c| c.id == *id).cloned())
        })
        .collect();
    // Deduplicate
    let mut seen = std::collections::HashSet::new();
    zone_cards.retain(|c| seen.insert(c.id.clone()));

    let min_choices = if is_optional { 0 } else { 1 };
    agent.send_prompt(
        AgentPromptInner::ChooseCardsForEffect {
            valid_card_ids,
            zone_cards,
            min_choices,
            max_choices: 1,
            source_card_name: Some(select_prompt.to_string()),
            optional: is_optional,
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::ChooseCardsDecision { chosen_card_ids } => {
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
    _player: PlayerId,
    valid: &[CardId],
    min: usize,
    max: usize,
    select_prompt: &str,
) -> Vec<CardId> {
    let valid_card_ids = PromptAgent::<T>::card_ids(valid);
    let view = agent.view();

    // Build zone_cards from all known zones + peeked library cards
    let peeked = std::mem::take(&mut agent.peeked_library_cards);
    let all_cards: Vec<&CardDto> = view.all_zone_cards().collect();
    let mut zone_cards: Vec<CardDto> = valid_card_ids
        .iter()
        .filter_map(|id| {
            all_cards
                .iter()
                .find(|c| c.id == *id)
                .map(|c| (*c).clone())
                .or_else(|| peeked.iter().find(|c| c.id == *id).cloned())
        })
        .collect();
    let mut seen = std::collections::HashSet::new();
    zone_cards.retain(|c| seen.insert(c.id.clone()));

    agent.send_prompt(
        AgentPromptInner::ChooseCardsForEffect {
            valid_card_ids,
            zone_cards,
            min_choices: min,
            max_choices: max,
            source_card_name: Some(select_prompt.to_string()),
            optional: false,
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::ChooseCardsDecision { chosen_card_ids } => chosen_card_ids
            .iter()
            .filter_map(|id| parse_card_id(id))
            .collect(),
        _ => valid.iter().copied().take(max).collect(),
    }
}

pub(super) fn choose_explore_put_in_graveyard<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    revealed_card_name: &str,
    _revealed_cmc: i32,
    _mana_producing_lands: usize,
    _predicted_mana: usize,
    _lands_in_hand: usize,
) -> bool {
    let peeked = std::mem::take(&mut agent.peeked_library_cards);
    let revealed_card = peeked.into_iter().next();
    agent.send_prompt(
        AgentPromptInner::ExploreDecision {
            revealed_card_name: revealed_card_name.to_string(),
            revealed_card,
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::ExploreResponse { put_in_graveyard } => put_in_graveyard,
        _ => false,
    }
}

pub(super) fn help_pay_assist<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    card_name: &str,
    max_generic: u32,
) -> u32 {
    agent.send_prompt(
        AgentPromptInner::HelpPayAssist {
            card_name: card_name.to_string(),
            max_generic,
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::AssistDecision { amount_to_pay } => amount_to_pay.min(max_generic),
        _ => 0,
    }
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
    agent.send_prompt(
        AgentPromptInner::ChooseMode {
            options: vec!["Land".to_string(), "Spell".to_string()],
            min_choices: 1,
            max_choices: 1,
            source_card_name: Some("Choose land or spell".to_string()),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::ModeDecision { chosen_indices } => match chosen_indices.first().copied() {
            Some(0) => Some(true),
            Some(1) => Some(false),
            _ => None,
        },
        _ => None,
    }
}

/// Choose which replacement effect to apply when multiple effects match.
/// Reuses the ChooseMode prompt — structurally identical (pick one from a list).
pub(super) fn choose_single_replacement_effect<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    descriptions: &[String],
) -> usize {
    if descriptions.is_empty() {
        return 0;
    }
    agent.send_prompt(
        AgentPromptInner::ChooseMode {
            options: descriptions.to_vec(),
            min_choices: 1,
            max_choices: 1,
            source_card_name: Some("Replacement Effect".to_string()),
        },
        None,
    );
    match agent.recv_action() {
        PlayerAction::ModeDecision { chosen_indices } => {
            chosen_indices.first().copied().unwrap_or(0)
        }
        _ => 0,
    }
}
