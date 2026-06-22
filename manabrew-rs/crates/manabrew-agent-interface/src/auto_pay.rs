///
/// DO NOT USE THIS MODULE FOR PARITY HANDLER
/// AUTO PAY, USE THE PARITY AUTOPAY ENGINE INSTEAD
///
use std::collections::HashMap;

use crate::game_view_dto::GameViewDto;
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

fn mana_matches_color(mana: &Mana, letter: &str) -> bool {
    let color = match letter {
        "W" => ManaColor::White,
        "U" => ManaColor::Blue,
        "B" => ManaColor::Black,
        "R" => ManaColor::Red,
        "G" => ManaColor::Green,
        "C" => ManaColor::Colorless,
        _ => return false,
    };
    mana.color == color
}

fn action_produces_color(action: &AvailableAction, letter: &str) -> bool {
    match &action.kind {
        AvailableActionKind::ActivateAbility(info) => info
            .produced_mana
            .as_ref()
            .map(|mana| mana.iter().any(|m| mana_matches_color(m, letter)))
            .unwrap_or(false),
        _ => false,
    }
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
    actions: &[AvailableAction],
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

    for needed in &needed_colors {
        if let Some(action) = actions
            .iter()
            .find(|action| action_produces_color(action, needed))
        {
            return Some(PromptOutput::PayManaCost(PayManaCostOutput::Act {
                action_id: action.id.clone(),
            }));
        }
    }

    if can_pay_mana_cost(&player_pool, mana_cost, player_life) {
        return Some(PromptOutput::PayManaCost(PayManaCostOutput::Pay {
            auto: true,
        }));
    }

    actions
        .iter()
        .find(|action| matches!(action.kind, AvailableActionKind::ActivateAbility(_)))
        .map(|action| {
            PromptOutput::PayManaCost(PayManaCostOutput::Act {
                action_id: action.id.clone(),
            })
        })
}
