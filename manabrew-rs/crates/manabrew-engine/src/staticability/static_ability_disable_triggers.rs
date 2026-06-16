use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card};
use crate::event::RunParams;
use crate::game::GameState;
use crate::ids::CardId;
use crate::parsing::CompiledSelector;
use crate::trigger::Trigger;
use crate::trigger::TriggerType;

pub fn is_disabled(
    game: &GameState,
    trigger_host: CardId,
    regtrig: &Trigger,
    _run_params: &RunParams,
) -> bool {
    let host = game.card(trigger_host);
    for source in game
        .cards
        .iter()
        .filter(|c| c.zone == ZoneType::Battlefield)
    {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&crate::staticability::StaticMode::DisableTriggers))
        {
            if let Some(valid_mode) = st_ab.ir.valid_mode.as_deref() {
                let modes = valid_mode.split(',').map(|s| s.trim());
                let trig_mode = regtrig.kind.name();
                if !modes.clone().any(|m| m.eq_ignore_ascii_case(trig_mode)) {
                    continue;
                }
            }
            if let Some(valid_card) = st_ab.ir.valid_card.as_ref() {
                if !matches_valid_card(valid_card, host, source) {
                    continue;
                }
            }
            if let Some(valid_trigger) = st_ab.ir.valid_trigger.as_deref() {
                if !trigger_matches(valid_trigger, game, trigger_host, regtrig) {
                    continue;
                }
            }
            if !mode_specific_matches(st_ab, game, regtrig, _run_params, source.controller) {
                continue;
            }
            return true;
        }
    }
    false
}

pub fn disabled(
    game: &GameState,
    trigger_host: CardId,
    regtrig: &Trigger,
    run_params: &RunParams,
) -> bool {
    is_disabled(game, trigger_host, regtrig, run_params)
}

fn mode_specific_matches(
    st_ab: &crate::staticability::StaticAbility,
    game: &GameState,
    regtrig: &Trigger,
    run_params: &RunParams,
    source_controller: crate::ids::PlayerId,
) -> bool {
    match regtrig.kind {
        TriggerType::ChangesZone => {
            let origin = regtrig.origin_zone();
            let moved = if origin == Some(ZoneType::Battlefield) {
                run_params.card_lki
            } else {
                run_params.card
            };
            if let Some(valid_cause) = st_ab.ir.valid_cause.as_ref() {
                let Some(cid) = moved else {
                    return false;
                };
                if !matches_valid_card_for_controller(
                    valid_cause,
                    game.card(cid),
                    source_controller,
                ) {
                    return false;
                }
            }
            if !st_ab.ir.origin_zones.is_empty()
                && !matches_zones(&st_ab.ir.origin_zones, run_params.origin)
            {
                return false;
            }
            if !st_ab.ir.destination_zones.is_empty()
                && !matches_zones(&st_ab.ir.destination_zones, run_params.destination)
            {
                return false;
            }
            true
        }
        TriggerType::ChangesZoneAll => {
            if let Some(valid_cause) = st_ab.ir.valid_cause.as_ref() {
                let Some(cause_sa) = run_params.cause.as_ref() else {
                    return false;
                };
                let Some(cause_card) = cause_sa.source else {
                    return false;
                };
                if !matches_valid_card_for_controller(
                    valid_cause,
                    game.card(cause_card),
                    source_controller,
                ) {
                    return false;
                }
            }
            let Some(zone_changes) = run_params.zone_changes.as_ref() else {
                return false;
            };
            let origin = regtrig.origin_zone();
            let destination = regtrig.destination_zone();
            zone_changes.iter().any(|zc| {
                origin.is_none_or(|expected| zc.origin == expected)
                    && destination.is_none_or(|expected| zc.destination == expected)
            })
        }
        TriggerType::SpellCast
        | TriggerType::AbilityCast
        | TriggerType::SpellAbilityCast
        | TriggerType::SpellCastOrCopy
        | TriggerType::SpellCopied
        | TriggerType::SpellCopy
        | TriggerType::SpellAbilityCopy => {
            if let Some(valid_cause) = st_ab.ir.valid_cause.as_ref() {
                let Some(cid) = run_params.spell_card else {
                    return false;
                };
                if !matches_valid_card_for_controller(
                    valid_cause,
                    game.card(cid),
                    source_controller,
                ) {
                    return false;
                }
            }
            if let Some(valid_activator) = st_ab.ir.valid_activator.as_ref() {
                let Some(pid) = run_params.spell_controller else {
                    return false;
                };
                if !matches_valid_player(valid_activator, pid, source_controller) {
                    return false;
                }
            }
            true
        }
        TriggerType::Attacks => {
            if let Some(valid_cause) = st_ab.ir.valid_cause.as_ref() {
                let Some(attacker) = run_params.attacker else {
                    return false;
                };
                if !matches_valid_card_for_controller(
                    valid_cause,
                    game.card(attacker),
                    source_controller,
                ) {
                    return false;
                }
            }
            true
        }
        TriggerType::DamageDone | TriggerType::DamageDealtOnce => {
            if let Some(wanted) = st_ab.ir.combat_damage {
                if run_params.is_combat_damage != Some(wanted) {
                    return false;
                }
            }
            if let Some(valid_source) = st_ab.ir.valid_source.as_ref() {
                let Some(source_id) = run_params.damage_source else {
                    return false;
                };
                if !matches_valid_card_for_controller(
                    valid_source,
                    game.card(source_id),
                    source_controller,
                ) {
                    return false;
                }
            }
            if let Some(valid_target) = st_ab.ir.valid_target.as_ref() {
                if let Some(target_card) = run_params.damage_target_card {
                    if !matches_valid_card_for_controller(
                        valid_target,
                        game.card(target_card),
                        source_controller,
                    ) {
                        return false;
                    }
                } else if let Some(target_player) = run_params.damage_target_player {
                    if !matches_valid_player(valid_target, target_player, source_controller) {
                        return false;
                    }
                }
            }
            true
        }
        _ => true,
    }
}

fn matches_valid_card(valid: &CompiledSelector, card: &Card, source: &Card) -> bool {
    valid_filter::matches_valid_card_selector(valid, card, source)
}

fn matches_valid_card_for_controller(
    valid: &CompiledSelector,
    card: &Card,
    source_controller: crate::ids::PlayerId,
) -> bool {
    let mut dummy_source = card.clone();
    dummy_source.controller = source_controller;
    valid_filter::matches_valid_card_selector(valid, card, &dummy_source)
}

fn matches_valid_player(
    valid: &CompiledSelector,
    player: crate::ids::PlayerId,
    source_controller: crate::ids::PlayerId,
) -> bool {
    valid_filter::matches_valid_player_selector(valid, player, source_controller)
}

fn trigger_matches(
    valid_trigger: &str,
    game: &GameState,
    trigger_host: CardId,
    regtrig: &Trigger,
) -> bool {
    let host = game.card(trigger_host);
    let Some(exec_text) = host.svars.get(&regtrig.execute) else {
        return false;
    };
    valid_trigger
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .all(|tok| match tok.to_ascii_lowercase().as_str() {
            "spell" => exec_text.trim_start().starts_with("SP$"),
            "ability" => {
                let trimmed = exec_text.trim_start();
                trimmed.starts_with("AB$") || trimmed.starts_with("DB$")
            }
            "trigger" => true,
            _ => true,
        })
}

#[allow(dead_code)]
fn matches_zone(filter: &str, zone: Option<ZoneType>) -> bool {
    let Some(zone) = zone else {
        return false;
    };
    match filter.to_ascii_lowercase().as_str() {
        "battlefield" => zone == ZoneType::Battlefield,
        "hand" => zone == ZoneType::Hand,
        "graveyard" => zone == ZoneType::Graveyard,
        "library" => zone == ZoneType::Library,
        "exile" => zone == ZoneType::Exile,
        "stack" => zone == ZoneType::Stack,
        "command" => zone == ZoneType::Command,
        "any" => true,
        _ => true,
    }
}

fn matches_zones(filters: &[ZoneType], zone: Option<ZoneType>) -> bool {
    let Some(zone) = zone else {
        return false;
    };
    filters.contains(&zone)
}
