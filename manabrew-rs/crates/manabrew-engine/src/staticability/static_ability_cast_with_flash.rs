use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::ids::PlayerId;
use crate::parsing::{keys, raw_get};
use crate::staticability::StaticMode;

pub fn any_with_flash(
    cards: &[Card],
    spell_card: &Card,
    caster: PlayerId,
    spell_abilities: &[String],
) -> bool {
    // Java includes both global static sources and the card itself.
    for source in cards.iter().filter(|c| {
        c.zone == ZoneType::Battlefield || c.zone == ZoneType::Command || c.id == spell_card.id
    }) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CastWithFlash))
        {
            if !matches_valid_card(st_ab.ir.valid_card.as_ref(), spell_card, source) {
                continue;
            }
            if !matches_valid_player(st_ab.ir.caster.as_ref(), caster, source.controller) {
                continue;
            }
            if let Some(valid_sa) = st_ab.ir.valid_sa.as_deref() {
                // "Spell" matches any card being cast as a spell (creatures,
                // sorceries, etc.) — not just cards with explicit SP$ lines.
                // Java treats the inherent spell ability of a card as matching.
                let sa_matches = valid_sa
                    .split(',')
                    .map(str::trim)
                    .any(|tok| tok.eq_ignore_ascii_case("Spell"))
                    || spell_abilities
                        .iter()
                        .any(|line| spell_ability_matches(valid_sa, line));
                if !sa_matches {
                    continue;
                }
            }
            return true;
        }
    }
    false
}

pub fn any_with_flash_for_card(cards: &[Card], spell_card: &Card, caster: PlayerId) -> bool {
    for source in cards.iter().filter(|c| {
        c.zone == ZoneType::Battlefield || c.zone == ZoneType::Command || c.id == spell_card.id
    }) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CastWithFlash))
        {
            if !matches_valid_card(st_ab.ir.valid_card.as_ref(), spell_card, source) {
                continue;
            }
            if !matches_valid_player(st_ab.ir.caster.as_ref(), caster, source.controller) {
                continue;
            }
            if let Some(valid_sa) = st_ab.ir.valid_sa.as_deref() {
                let sa_matches = if spell_card.action_spell_specs.is_empty() {
                    valid_sa
                        .split(',')
                        .map(str::trim)
                        .filter(|tok| !tok.is_empty())
                        .all(|tok| tok.eq_ignore_ascii_case("Spell"))
                } else {
                    spell_card
                        .action_spell_specs
                        .iter()
                        .any(|spec| spell_ability_spec_matches(valid_sa, spec))
                };
                if !sa_matches {
                    continue;
                }
            }
            return true;
        }
    }
    false
}

pub fn any_with_flash_needs_info(
    cards: &[Card],
    spell_card: &Card,
    caster: PlayerId,
    spell_abilities: &[String],
) -> bool {
    any_with_flash(cards, spell_card, caster, spell_abilities)
}

pub fn apply_with_flash_needs_info(
    st_ab: &crate::staticability::StaticAbility,
    spell_card: &Card,
    source: &Card,
    caster: PlayerId,
    spell_abilities: &[String],
) -> bool {
    if !matches_valid_card(st_ab.ir.valid_card.as_ref(), spell_card, source) {
        return false;
    }
    if !matches_valid_player(st_ab.ir.caster.as_ref(), caster, source.controller) {
        return false;
    }
    if let Some(valid_sa) = st_ab.ir.valid_sa.as_deref() {
        let sa_matches = valid_sa
            .split(',')
            .map(str::trim)
            .any(|tok| tok.eq_ignore_ascii_case("Spell"))
            || spell_abilities
                .iter()
                .any(|line| spell_ability_matches(valid_sa, line));
        if !sa_matches {
            return false;
        }
    }
    true
}

pub fn apply_with_flash_ability(
    st_ab: &crate::staticability::StaticAbility,
    spell_card: &Card,
    source: &Card,
    caster: PlayerId,
) -> bool {
    matches_valid_card(st_ab.ir.valid_card.as_ref(), spell_card, source)
        && matches_valid_player(st_ab.ir.caster.as_ref(), caster, source.controller)
}

fn matches_valid_player(
    valid: Option<&crate::parsing::CompiledSelector>,
    player: PlayerId,
    source_controller: PlayerId,
) -> bool {
    valid_filter::matches_valid_player_selector_opt(valid, player, source_controller)
}

fn matches_valid_card(
    valid: Option<&crate::parsing::CompiledSelector>,
    card: &Card,
    source: &Card,
) -> bool {
    valid_filter::matches_valid_card_selector_opt(valid, card, source)
}

fn spell_ability_matches(valid_sa: &str, ability_line: &str) -> bool {
    let is_spell = ability_line.trim_start().starts_with("SP$");
    if !is_spell {
        return false;
    }
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
            "spell" => true,
            "istargeting" => ability_line.contains("ValidTgts$"),
            "xcost" => raw_get(ability_line, keys::COST).is_some_and(|cost| cost.contains('X')),
            _ => false,
        })
}

fn spell_ability_spec_matches(valid_sa: &str, spec: &crate::card::CardActionSpellSpec) -> bool {
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
            "spell" => true,
            "istargeting" => spec.has_valid_tgts,
            "xcost" => spec.cost_contains_x,
            _ => false,
        })
}
