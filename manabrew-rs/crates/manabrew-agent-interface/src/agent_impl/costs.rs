use forge_foundation::ManaAtom;
use manabrew_engine::agent::{ManaAbilityOption, ManaCostAction};
use manabrew_engine::ids::{CardId, PlayerId};
use manabrew_engine::mana::ManaPool;

use manabrew_protocol::prompts::choose_boolean::ChooseBooleanInput;
use manabrew_protocol::prompts::common::PromptPresentation;

use crate::ids_codec::{card_id_str, parse_card_id};
use crate::prompt::{PlayerAction, PromptInput};

use super::{PromptAgent, Responder};

fn choose_boolean<T: Responder>(
    agent: &mut PromptAgent<T>,
    presentation: PromptPresentation,
    confirm_label: &str,
    deny_label: &str,
    source: Option<CardId>,
) -> bool {
    agent.send_prompt(
        PromptInput::ChooseBoolean(ChooseBooleanInput {
            presentation,
            confirm_label: confirm_label.to_string(),
            deny_label: deny_label.to_string(),
        }),
        source,
    );
    match agent.recv_action() {
        PlayerAction::Decision { value } => value,
        _ => false,
    }
}

pub(super) fn choose_phyrexian_pay_life<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    color: &str,
    source: Option<CardId>,
) -> bool {
    let shards: Vec<&str> = color.split(',').map(str::trim).collect();
    let life_cost = shards.len() * 2;
    let phyrexian_cost: String = shards.iter().map(|s| format!("{{{s}}}")).collect();
    let mana_cost: String = shards
        .iter()
        .map(|s| format!("{{{}}}", s.replace("/P", "")))
        .collect();
    choose_boolean(
        agent,
        PromptPresentation {
            title: "Pay Phyrexian?".to_string(),
            description: Some(format!(
                "Pay {phyrexian_cost} with {life_cost} life, or pay {mana_cost} mana instead?"
            )),
            text: None,
            source_card_id: source.map(card_id_str),
            targets: Vec::new(),
        },
        &format!("Pay {life_cost} Life"),
        "Pay Mana",
        source,
    )
}

pub(super) fn choose_kicker<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    kicker_cost: &str,
    source: Option<CardId>,
) -> bool {
    choose_boolean(
        agent,
        PromptPresentation {
            title: "Pay Kicker?".to_string(),
            description: Some(format!("Pay additional kicker cost: {kicker_cost}")),
            text: None,
            source_card_id: source.map(card_id_str),
            targets: Vec::new(),
        },
        "Pay Kicker",
        "No",
        source,
    )
}

pub(super) fn choose_buyback<T: Responder>(
    agent: &mut PromptAgent<T>,
    _player: PlayerId,
    buyback_cost: &str,
    source: Option<CardId>,
) -> bool {
    choose_boolean(
        agent,
        PromptPresentation {
            title: "Pay Buyback?".to_string(),
            description: Some(format!("Pay additional buyback cost: {buyback_cost}")),
            text: Some(
                "If paid, this spell returns to your hand instead of going to the graveyard."
                    .to_string(),
            ),
            source_card_id: source.map(card_id_str),
            targets: Vec::new(),
        },
        "Pay Buyback",
        "No",
        source,
    )
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
            manabrew_protocol::prompts::choose_multikicker::ChooseMultikickerInput {
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
            manabrew_protocol::prompts::choose_replicate::ChooseReplicateInput {
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
        PromptInput::PayManaCost(
            manabrew_protocol::prompts::pay_mana_cost::PayManaCostInput {
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
                tappable_source_ids: tappable_land_ids,
                untappable_source_ids: untappable_land_ids,
                mana_pool_total: mana_pool.total_mana(),
                can_confirm_from_pool,
            },
        ),
        Some(card_id),
    );
    match agent.recv_action() {
        PlayerAction::TapForMana {
            card_id,
            ability_index,
            color,
        } => parse_card_id(&card_id)
            .map(|card_id| ManaCostAction::TapForMana {
                card_id,
                mana_ability_index: ability_index,
                express_choice: color
                    .as_deref()
                    .map(|color| ManaAtom::from_name(&color.to_ascii_lowercase()))
                    .filter(|&atom| atom != 0),
            })
            .unwrap_or(ManaCostAction::AttemptedAndFailed),
        PlayerAction::Untap { card_id } => parse_card_id(&card_id)
            .map(ManaCostAction::Untap)
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
            manabrew_protocol::prompts::specify_mana_combo::SpecifyManaComboInput {
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
        PromptInput::ChooseDelve(manabrew_protocol::prompts::choose_delve::ChooseDelveInput {
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

// Convoke and improvise are resolved interactively inside the mana-payment
// session (tap a creature/artifact as a mana source), not as an upfront batch.
// A human agent declines the batch reduction so the cost stays full until
// payment, where `TapForMana` against a convoke source contributes mana.
pub(super) fn choose_improvise<T: Responder>(
    _agent: &mut PromptAgent<T>,
    _player: PlayerId,
    _untapped_artifacts: &[CardId],
    _remaining_cost: &forge_foundation::ManaCost,
    _source: Option<CardId>,
) -> Vec<CardId> {
    Vec::new()
}

pub(super) fn choose_convoke<T: Responder>(
    _agent: &mut PromptAgent<T>,
    _player: PlayerId,
    _untapped_creatures: &[CardId],
    _remaining_cost: &forge_foundation::ManaCost,
    _source: Option<CardId>,
) -> Vec<CardId> {
    Vec::new()
}
