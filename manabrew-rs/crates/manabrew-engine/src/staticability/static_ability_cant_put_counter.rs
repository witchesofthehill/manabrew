use forge_foundation::ZoneType;

use crate::card::{valid_filter, Card, CounterType};
use crate::ids::PlayerId;
use crate::staticability::StaticMode;

pub fn any_cant_put_counter_on_card(
    cards: &[Card],
    target: &Card,
    counter_type: &CounterType,
) -> bool {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::StaticAbility);
    for source in cards.iter().filter(|c| c.zone == ZoneType::Battlefield) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CantPutCounter))
        {
            if !counter_type_matches(st_ab.ir.counter_type.as_ref(), counter_type) {
                continue;
            }
            if !matches_valid_card(st_ab.ir.valid_card.as_ref(), target, source) {
                continue;
            }
            if st_ab.ir.has_valid_player {
                continue;
            }
            return true;
        }
    }
    false
}

pub fn any_cant_put_counter_on_player(
    cards: &[Card],
    player: PlayerId,
    counter_type: &CounterType,
) -> bool {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::StaticAbility);
    for source in cards.iter().filter(|c| c.zone == ZoneType::Battlefield) {
        for st_ab in source
            .static_abilities
            .iter()
            .filter(|sa| sa.check_mode(&StaticMode::CantPutCounter))
        {
            if !counter_type_matches(st_ab.ir.counter_type.as_ref(), counter_type) {
                continue;
            }
            if !matches_valid_player(st_ab.ir.valid_player.as_ref(), player, source.controller) {
                continue;
            }
            if st_ab.ir.has_valid_card {
                continue;
            }
            return true;
        }
    }
    false
}

pub fn any_cant_put_counter(
    cards: &[Card],
    target_card: Option<&Card>,
    target_player: Option<PlayerId>,
    counter_type: &CounterType,
) -> bool {
    if let Some(card) = target_card {
        return any_cant_put_counter_on_card(cards, card, counter_type);
    }
    if let Some(player) = target_player {
        return any_cant_put_counter_on_player(cards, player, counter_type);
    }
    false
}

pub fn apply_cant_put_counter(
    st_ab: &crate::staticability::StaticAbility,
    source: &Card,
    target_card: Option<&Card>,
    target_player: Option<PlayerId>,
    counter_type: &CounterType,
) -> bool {
    let _perf_scope =
        crate::perf::ParamsLookupScopeGuard::enter(crate::perf::ParamsLookupScope::StaticAbility);
    if !counter_type_matches(st_ab.ir.counter_type.as_ref(), counter_type) {
        return false;
    }
    if let Some(card) = target_card {
        if st_ab.ir.has_valid_player {
            return false;
        }
        return matches_valid_card(st_ab.ir.valid_card.as_ref(), card, source);
    }
    if let Some(player) = target_player {
        if st_ab.ir.has_valid_card {
            return false;
        }
        return matches_valid_player(st_ab.ir.valid_player.as_ref(), player, source.controller);
    }
    false
}

fn counter_type_matches(param: Option<&CounterType>, ct: &CounterType) -> bool {
    match param {
        None => true,
        Some(p) => *p == *ct,
    }
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
