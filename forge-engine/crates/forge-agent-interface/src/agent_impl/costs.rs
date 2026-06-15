use forge_engine_core::agent::{ManaAbilityOption, ManaCostAction};
use forge_engine_core::ids::{CardId, PlayerId};
use forge_engine_core::mana::ManaPool;
use forge_foundation::ManaAtom;

use crate::ids_codec::{card_id_str, parse_card_id};
use crate::prompt::{PlayerAction, PromptInput};

use super::{PromptAgent, Responder};

pub(super) fn choose_phyrexian_pay_life<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    color: &str,
    source: Option<CardId>,
) -> bool {
    agent.send_prompt(
        PromptInput::ChoosePhyrexian(
            forge_protocol::prompts::choose_phyrexian::ChoosePhyrexianInput {
                phyrexian_color: color.to_string(),
            },
        ),
        source,
    );
    match agent.recv_action() {
        PlayerAction::PhyrexianDecision { pay_life } => pay_life,
        _ => false,
    }
}

pub(super) fn choose_kicker<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    kicker_cost: &str,
    source: Option<CardId>,
) -> bool {
    agent.send_prompt(
        PromptInput::ChooseKicker(forge_protocol::prompts::choose_kicker::ChooseKickerInput {
            kicker_cost: kicker_cost.to_string(),
        }),
        source,
    );
    match agent.recv_action() {
        PlayerAction::KickerDecision { kicked } => kicked,
        _ => false,
    }
}

pub(super) fn choose_buyback<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    buyback_cost: &str,
    source: Option<CardId>,
) -> bool {
    agent.send_prompt(
        PromptInput::ChooseBuyback(
            forge_protocol::prompts::choose_buyback::ChooseBuybackInput {
                buyback_cost: buyback_cost.to_string(),
            },
        ),
        source,
    );
    match agent.recv_action() {
        PlayerAction::BuybackDecision { buyback_paid } => buyback_paid,
        _ => false,
    }
}

pub(super) fn choose_multikicker<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    cost: &str,
    max_kicks: u32,
    source: Option<CardId>,
) -> u32 {
    agent.send_prompt(
        PromptInput::ChooseMultikicker(
            forge_protocol::prompts::choose_multikicker::ChooseMultikickerInput {
                cost: cost.to_string(),
                max_kicks,
            },
        ),
        source,
    );
    match agent.recv_action() {
        PlayerAction::MultikickerDecision { kick_count } => kick_count.min(max_kicks),
        _ => 0,
    }
}

pub(super) fn choose_replicate<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    cost: &str,
    max_replicates: u32,
    source: Option<CardId>,
) -> u32 {
    agent.send_prompt(
        PromptInput::ChooseReplicate(
            forge_protocol::prompts::choose_replicate::ChooseReplicateInput {
                cost: cost.to_string(),
                max_replicates,
            },
        ),
        source,
    );
    match agent.recv_action() {
        PlayerAction::ReplicateDecision { replicate_count } => replicate_count.min(max_replicates),
        _ => 0,
    }
}

pub(super) fn choose_alternative_cost<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    options: &[String],
    source: Option<CardId>,
) -> usize {
    agent.send_prompt(
        PromptInput::ChooseAlternativeCost(
            forge_protocol::prompts::choose_alternative_cost::ChooseAlternativeCostInput {
                options: options.to_vec(),
            },
        ),
        source,
    );
    match agent.recv_action() {
        PlayerAction::AlternativeCostDecision { chosen_index } => {
            chosen_index.min(options.len().saturating_sub(1))
        }
        _ => 0,
    }
}

pub(super) fn pay_mana_cost<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    card_id: CardId,
    card_name: &str,
    _mana_cost: &str,
    mana_cost_display: &str,
    can_confirm_from_pool: bool,
    mana_ability_options: &[ManaAbilityOption],
    tappable_lands: &[CardId],
    untappable_lands: &[CardId],
    mana_pool: &ManaPool,
) -> ManaCostAction {
    let card_id_s = card_id_str(card_id);
    let tappable_land_ids = PromptAgent::<T>::card_ids(tappable_lands);
    let untappable_land_ids = PromptAgent::<T>::card_ids(untappable_lands);

    agent.send_prompt(
        PromptInput::PayManaCost(forge_protocol::prompts::pay_mana_cost::PayManaCostInput {
            card_id: card_id_s,
            card_name: card_name.to_string(),
            mana_cost: mana_cost_display.to_string(),
            mana_ability_options: mana_ability_options
                .iter()
                .map(|opt| crate::prompt::ActivatableAbilityInfo {
                    card_id: card_id_str(opt.card_id),
                    ability_index: opt.ability_index,
                    description: opt.description.clone(),
                    is_mana_ability: true,
                    cost: None,
                })
                .collect(),
            tappable_land_ids,
            untappable_land_ids,
            mana_pool_total: mana_pool.total_mana(),
            can_confirm_from_pool,
        }),
        Some(card_id),
    );
    match agent.recv_action() {
        PlayerAction::TapLand {
            card_id,
            ability_index,
            color,
        } => parse_card_id(&card_id)
            .map(|card_id| ManaCostAction::TapLand {
                card_id,
                mana_ability_index: ability_index,
                express_choice: color
                    .as_deref()
                    .map(|color| ManaAtom::from_name(&color.to_ascii_lowercase()))
                    .filter(|&atom| atom != 0),
            })
            .unwrap_or(ManaCostAction::AttemptedAndFailed),
        PlayerAction::UntapLand { card_id } => parse_card_id(&card_id)
            .map(ManaCostAction::UntapLand)
            .unwrap_or(ManaCostAction::AttemptedAndFailed),
        PlayerAction::PayManaCost { auto } => ManaCostAction::Pay { auto },
        PlayerAction::CancelManaCost => ManaCostAction::AttemptedAndFailed,
        _ => ManaCostAction::AttemptedAndFailed,
    }
}

pub(super) fn specify_mana_combo<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    available_colors: &[String],
    amount: usize,
    source: Option<CardId>,
    express_choice: Option<u16>,
) -> Vec<String> {
    if let Some(atom) = express_choice {
        let letter = ManaPool::atom_to_letter(atom);
        if let Some(matched) = super::find_matching_color(letter, available_colors.iter()) {
            return vec![matched; amount];
        }
    }

    agent.send_prompt(
        PromptInput::SpecifyManaCombo(
            forge_protocol::prompts::specify_mana_combo::SpecifyManaComboInput {
                available_colors: available_colors.to_vec(),
                amount,
            },
        ),
        source,
    );
    let action = agent.recv_action();
    match action {
        PlayerAction::ManaComboDecision { chosen_colors } => {
            // Validate: only return valid colors, pad/truncate to amount
            let mut result: Vec<String> = chosen_colors
                .into_iter()
                .filter(|c| available_colors.contains(c))
                .collect();
            // Pad with first available color if needed
            while result.len() < amount {
                result.push(available_colors.first().cloned().unwrap_or("C".to_string()));
            }
            result.truncate(amount);
            result
        }
        _ => {
            // Default: all first color
            vec![available_colors.first().cloned().unwrap_or("C".to_string()); amount]
        }
    }
}

pub(super) fn choose_delve<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    valid: &[CardId],
    max: usize,
    source: Option<CardId>,
) -> Vec<CardId> {
    let valid_ids = PromptAgent::<T>::card_ids(valid);
    // Build CardDtos for the graveyard cards
    let zone_cards: Vec<_> = valid
        .iter()
        .filter_map(|&cid| {
            agent.latest_view.as_ref().and_then(|v| {
                v.players
                    .iter()
                    .flat_map(|p| p.graveyard.iter())
                    .find(|c| c.id == card_id_str(cid))
                    .cloned()
            })
        })
        .collect();

    agent.send_prompt(
        PromptInput::ChooseDelve(forge_protocol::prompts::choose_delve::ChooseDelveInput {
            valid_card_ids: valid_ids,
            zone_cards,
            max_cards: max,
        }),
        source,
    );
    match agent.recv_action() {
        PlayerAction::DelveDecision { chosen_card_ids } => chosen_card_ids
            .iter()
            .filter_map(|id| parse_card_id(id))
            .filter(|cid| valid.contains(cid))
            .take(max)
            .collect(),
        _ => vec![],
    }
}

pub(super) fn choose_improvise<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    untapped_artifacts: &[CardId],
    remaining_cost: &forge_foundation::ManaCost,
    source: Option<CardId>,
) -> Vec<CardId> {
    let valid_ids = PromptAgent::<T>::card_ids(untapped_artifacts);

    agent.send_prompt(
        PromptInput::ChooseImprovise(
            forge_protocol::prompts::choose_improvise::ChooseImproviseInput {
                valid_card_ids: valid_ids,
                remaining_cost: remaining_cost.to_string(),
            },
        ),
        source,
    );
    match agent.recv_action() {
        PlayerAction::ImproviseDecision { chosen_card_ids } => chosen_card_ids
            .iter()
            .filter_map(|id| parse_card_id(id))
            .filter(|cid| untapped_artifacts.contains(cid))
            .collect(),
        _ => vec![],
    }
}

pub(super) fn choose_convoke<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    untapped_creatures: &[CardId],
    remaining_cost: &forge_foundation::ManaCost,
    source: Option<CardId>,
) -> Vec<CardId> {
    let valid_ids = PromptAgent::<T>::card_ids(untapped_creatures);

    agent.send_prompt(
        PromptInput::ChooseConvoke(
            forge_protocol::prompts::choose_convoke::ChooseConvokeInput {
                valid_card_ids: valid_ids,
                remaining_cost: remaining_cost.to_string(),
            },
        ),
        source,
    );
    match agent.recv_action() {
        PlayerAction::ConvokeDecision { chosen_card_ids } => chosen_card_ids
            .iter()
            .filter_map(|id| parse_card_id(id))
            .filter(|cid| untapped_creatures.contains(cid))
            .collect(),
        _ => vec![],
    }
}
