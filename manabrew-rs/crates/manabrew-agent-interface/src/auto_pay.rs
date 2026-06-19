///
/// DO NOT USE THIS MODULE FOR PARITY HANDLER
/// AUTO PAY, USE THE PARITY AUTOPAY ENGINE INSTEAD
///
use std::collections::HashMap;

use crate::game_view_dto::{CardDto, GameViewDto};
use crate::prompt::*;

fn parse_mana_tokens(mana_cost: &str) -> Vec<String> {
    mana_cost
        .match_indices('{')
        .filter_map(|(start, _)| {
            mana_cost[start + 1..]
                .find('}')
                .map(|end| mana_cost[start + 1..start + 1 + end].to_string())
        })
        .collect()
}

fn card_mana_colors(card: &CardDto) -> Vec<String> {
    let mut colors = Vec::new();
    for subtype in &card.subtypes {
        let color = match subtype.as_str() {
            "Plains" => Some("W"),
            "Island" => Some("U"),
            "Swamp" => Some("B"),
            "Mountain" => Some("R"),
            "Forest" => Some("G"),
            _ => None,
        };
        if let Some(color) = color {
            if !colors.iter().any(|c| c == color) {
                colors.push(color.to_string());
            }
        }
    }
    colors
}

fn ability_mana_colors(description: &str) -> Vec<String> {
    let mut colors = Vec::new();
    let upper = description.to_ascii_uppercase();
    if upper.contains("ANY COLOR") {
        return vec!["W", "U", "B", "R", "G"]
            .into_iter()
            .map(str::to_string)
            .collect();
    }
    for color in ["W", "U", "B", "R", "G", "C"] {
        if upper.contains(&format!("{{{color}}}")) || upper.contains(&format!(" {color} ")) {
            colors.push(color.to_string());
        }
    }
    colors
}

fn can_pay_mana_cost(pool: &HashMap<String, i32>, mana_cost: &str, player_life: i32) -> bool {
    let mut available = pool.clone();
    let mut generic = 0i32;
    let mut hybrids: Vec<(String, String)> = Vec::new();
    let mut phyrexian_life_needed = 0i32;

    for token in parse_mana_tokens(mana_cost) {
        if let Ok(n) = token.parse::<i32>() {
            generic += n;
            continue;
        }
        if token == "X" {
            continue;
        }
        if token.contains('/') {
            let mut parts = token.split('/');
            if let (Some(a), Some(b)) = (parts.next(), parts.next()) {
                if b == "P" {
                    let count = available.entry(a.to_string()).or_insert(0);
                    if *count > 0 {
                        *count -= 1;
                    } else {
                        phyrexian_life_needed += 2;
                    }
                    continue;
                }
                hybrids.push((a.to_string(), b.to_string()));
                continue;
            }
        }
        let count = available.entry(token.clone()).or_insert(0);
        if *count <= 0 {
            return false;
        }
        *count -= 1;
    }

    for (a, b) in hybrids {
        let a_count = *available.get(&a).unwrap_or(&0);
        let b_count = *available.get(&b).unwrap_or(&0);
        if a_count > 0 {
            if let Some(count) = available.get_mut(&a) {
                *count -= 1;
            }
        } else if b_count > 0 {
            if let Some(count) = available.get_mut(&b) {
                *count -= 1;
            }
        } else {
            return false;
        }
    }

    if phyrexian_life_needed > player_life {
        return false;
    }
    let remaining_total: i32 = available.values().copied().sum();
    remaining_total >= generic
}

pub fn choose_pay_mana_cost_action(
    game_view: &GameViewDto,
    mana_cost: &str,
    tappable_land_ids: &[String],
    mana_ability_options: &[ActivatableAbilityInfo],
) -> Option<PromptOutput> {
    let player_pool = game_view
        .players
        .iter()
        .find(|p| p.id == game_view.priority_player_id)
        .cloned();
    let player_life = player_pool.as_ref().map(|p| p.life).unwrap_or_default();
    let player_pool = player_pool.map(|p| p.mana_pool).unwrap_or_default();
    let mut needed_colors: Vec<String> = parse_mana_tokens(mana_cost)
        .into_iter()
        .filter_map(|token| {
            if token.len() == 1 && token != "X" {
                return Some(token);
            }
            if let Some(color) = token.strip_suffix("/P") {
                return Some(color.to_string());
            }
            None
        })
        .collect();
    for (color, amount) in &player_pool {
        for _ in 0..(*amount).max(0) {
            if let Some(pos) = needed_colors.iter().position(|needed| needed == color) {
                needed_colors.remove(pos);
            }
        }
    }

    let battlefield_by_id: HashMap<_, _> = game_view
        .battlefield
        .iter()
        .map(|card| (card.id.clone(), card))
        .collect();

    for needed in &needed_colors {
        if let Some(ability) = mana_ability_options.iter().find(|ability| {
            tappable_land_ids.contains(&ability.card_id)
                && ability_mana_colors(&ability.description)
                    .iter()
                    .any(|color| color == needed)
        }) {
            return Some(PromptOutput::ManaSource(ManaSourceAction::TapForMana {
                card_id: ability.card_id.clone(),
                ability_index: Some(ability.ability_index),
                color: Some(needed.clone()),
            }));
        }
        if let Some(card_id) = tappable_land_ids.iter().find(|card_id| {
            battlefield_by_id
                .get(*card_id)
                .map(|card| card_mana_colors(card).iter().any(|color| color == needed))
                .unwrap_or(false)
        }) {
            return Some(PromptOutput::ManaSource(ManaSourceAction::TapForMana {
                card_id: card_id.clone(),
                ability_index: None,
                color: Some(needed.clone()),
            }));
        }
    }

    if can_pay_mana_cost(&player_pool, mana_cost, player_life) {
        return Some(PromptOutput::PayManaCost(PayManaCostOutput::PayManaCost {
            auto: true,
        }));
    }

    if let Some(ability) = mana_ability_options
        .iter()
        .find(|ability| tappable_land_ids.contains(&ability.card_id))
    {
        return Some(PromptOutput::ManaSource(ManaSourceAction::TapForMana {
            card_id: ability.card_id.clone(),
            ability_index: Some(ability.ability_index),
            color: None,
        }));
    }

    tappable_land_ids.first().map(|card_id| {
        PromptOutput::ManaSource(ManaSourceAction::TapForMana {
            card_id: card_id.clone(),
            ability_index: None,
            color: None,
        })
    })
}
