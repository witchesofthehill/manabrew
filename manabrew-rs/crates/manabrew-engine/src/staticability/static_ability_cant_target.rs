use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::ids::PlayerId;
use crate::parsing::CompiledSelector;
use crate::spellability::SpellAbility;
use crate::staticability::StaticMode;

pub fn cant_target(
    cards: &[Card],
    target: &Card,
    activator: PlayerId,
    source_card: Option<&Card>,
    source_sa: Option<&SpellAbility>,
) -> bool {
    for source in cards.iter().filter(|c| c.zone == ZoneType::Battlefield) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CantTarget))
        {
            if !st_ab.ir.affected_zones.is_empty() {
                if !st_ab.ir.affected_zones.contains(&target.zone) {
                    continue;
                }
            } else if target.zone != ZoneType::Battlefield {
                continue;
            }

            if !matches_valid_target(st_ab.ir.valid_target.as_ref(), target, source) {
                continue;
            }
            if !matches_valid_activator(st_ab.ir.activator.as_ref(), activator, source.controller) {
                continue;
            }
            if let Some(valid_sa) = st_ab.ir.valid_sa.as_deref() {
                let Some(sa) = source_sa else {
                    continue;
                };
                if !spell_ability_matches(valid_sa, sa) {
                    continue;
                }
            }
            if let (Some(valid_source), Some(src)) = (st_ab.ir.valid_source.as_ref(), source_card) {
                if !matches_valid_target(Some(valid_source), src, source) {
                    continue;
                }
            }
            return true;
        }
    }
    false
}

pub fn apply_cant_target_ability(
    st_ab: &crate::staticability::StaticAbility,
    target: &Card,
    source: &Card,
    activator: PlayerId,
    source_card: Option<&Card>,
    source_sa: Option<&SpellAbility>,
) -> bool {
    if !st_ab.ir.affected_zones.is_empty() {
        if !st_ab.ir.affected_zones.contains(&target.zone) {
            return false;
        }
    } else if target.zone != ZoneType::Battlefield {
        return false;
    }

    if !matches_valid_target(st_ab.ir.valid_target.as_ref(), target, source) {
        return false;
    }
    if !matches_valid_activator(st_ab.ir.activator.as_ref(), activator, source.controller) {
        return false;
    }
    if let Some(valid_sa) = st_ab.ir.valid_sa.as_deref() {
        let Some(sa) = source_sa else {
            return false;
        };
        if !spell_ability_matches(valid_sa, sa) {
            return false;
        }
    }
    if let (Some(valid_source), Some(src)) = (st_ab.ir.valid_source.as_ref(), source_card) {
        if !matches_valid_target(Some(valid_source), src, source) {
            return false;
        }
    }
    true
}

fn spell_ability_matches(valid_sa: &str, sa: &SpellAbility) -> bool {
    let tokens: Vec<&str> = valid_sa
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    if tokens.is_empty() {
        return true;
    }
    tokens
        .iter()
        .all(|tok| match tok.to_ascii_lowercase().as_str() {
            "spell" => sa.is_spell,
            "istargeting" => sa.target_restrictions.is_some(),
            "xcost" => sa.cost_has_x(),
            _ => false,
        })
}

fn matches_valid_activator(
    valid: Option<&CompiledSelector>,
    player: PlayerId,
    source_controller: PlayerId,
) -> bool {
    valid_filter::matches_valid_player_selector_opt(valid, player, source_controller)
}

fn matches_valid_target(valid: Option<&CompiledSelector>, target: &Card, source: &Card) -> bool {
    valid_filter::matches_valid_card_selector_opt(valid, target, source)
}
