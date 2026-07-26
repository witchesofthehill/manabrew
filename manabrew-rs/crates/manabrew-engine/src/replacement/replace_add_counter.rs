//! Replacement logic for `Event$ AddCounter`.
//!
//! Mirrors Java `ReplaceAddCounter.java` in `forge/game/replacement/`.

use crate::agent::GameEntity;
use crate::card::valid_filter;
use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;
use forge_foundation::{CardTypeLine, ColorSet, ManaCost, ZoneType};

use super::replacement_effect::ReplacementEffect;
use super::replacement_handler::ReplacementEvent;
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Check if the effect has a `ValidCounterType$` that matches the given counter type.
///
/// If no `ValidCounterType$` param is present, the effect applies to any counter
/// type, so return `true`. Otherwise, check if the given counter type name
/// matches the param value.
///
/// Mirrors Java `ReplaceAddCounter.hasAnyInCounterMap()`.
pub fn has_any_in_counter_map(effect: &ReplacementEffect, counter_type: Option<&str>) -> bool {
    match effect.ir.valid_counter_type_text.as_deref() {
        None => true, // No restriction — matches any counter type
        Some(valid) => match counter_type {
            None => false, // Effect requires a specific type but none given
            Some(ct) => valid.split(',').any(|v| v.trim().eq_ignore_ascii_case(ct)),
        },
    }
}

/// Check if this effect's event type matches the given event for AddCounter purposes.
///
/// Returns `true` if event is `AddCounter`, or if event is `Moved` and the
/// effect handles counter-on-move (has a `CounterMap` interaction).
///
/// Mirrors Java `ReplaceAddCounter.modeCheck()`.
pub fn mode_check(effect: &ReplacementEffect, event: &ReplacementType) -> bool {
    match event {
        ReplacementType::AddCounter => true,
        ReplacementType::Moved => effect.ir.counter_map,
        _ => false,
    }
}

/// Mirrors Java `ReplaceAddCounter.canReplace()`.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::AddCounter {
        return false;
    }
    let (target, counter_map, cause, is_effect, etb) = match event {
        ReplacementEvent::AddCounter {
            target,
            counter_map,
            cause,
            is_effect,
            ..
        } => (*target, counter_map, cause.as_deref(), *is_effect, false),
        ReplacementEvent::Moved {
            card,
            destination: ZoneType::Battlefield,
            counter_map: Some(counter_map),
            counter_cause,
            counter_is_effect,
            ..
        } => (
            GameEntity::Card(*card),
            counter_map,
            counter_cause.as_deref(),
            *counter_is_effect,
            true,
        ),
        _ => return false,
    };
    if effect.ir.effect_only && !is_effect {
        return false;
    }
    if let Some(valid) = effect.ir.valid_card_selector.as_ref() {
        let GameEntity::Card(target) = target else {
            return false;
        };
        let mut target_card = game.card(target).clone();
        if etb {
            target_card.zone = ZoneType::Battlefield;
        }
        if !effect.matches_compiled_valid_card(valid, &target_card, source_card) {
            return false;
        }
    }
    if let Some(valid) = effect.ir.valid_player_selector.as_ref() {
        let GameEntity::Player(target) = target else {
            return false;
        };
        if !effect.matches_compiled_valid_player(valid, target, source_card) {
            return false;
        }
    }
    if let Some(valid) = effect.ir.valid_object_selector.as_ref() {
        let matches = match target {
            GameEntity::Card(target) => {
                let mut target_card = game.card(target).clone();
                if etb {
                    target_card.zone = ZoneType::Battlefield;
                }
                effect.matches_compiled_valid_card(valid, &target_card, source_card)
            }
            GameEntity::Player(target) => {
                effect.matches_compiled_valid_player(valid, target, source_card)
            }
        };
        if !matches {
            return false;
        }
    }
    if etb
        && effect.base().host_card_id()
            == match target {
                GameEntity::Card(card) => card,
                GameEntity::Player(_) => return false,
            }
        && !effect
            .ir
            .valid_card_text
            .as_deref()
            .is_some_and(|valid| valid.starts_with("Card.Self"))
    {
        return false;
    }
    if let Some(valid) = effect.ir.valid_cause_text.as_deref() {
        let Some(cause) = cause else {
            return false;
        };
        let ability_host = cause.source.map(|card| game.card(card));
        if !crate::spellability::matches_valid_sa(valid, cause, source_card, ability_host) {
            return false;
        }
    }
    if !counter_map.iter().any(|entry| {
        let source_matches = effect
            .ir
            .valid_source_selector
            .as_ref()
            .is_none_or(|valid| {
                entry.source.is_some_and(|source| {
                    valid_filter::matches_valid_player_selector(
                        valid,
                        source,
                        source_card.controller,
                    )
                })
            });
        let type_matches = effect
            .ir
            .valid_counter_type_text
            .as_deref()
            .is_none_or(|valid| {
                let expected = crate::ability::effects::parse_counter_type(valid);
                entry.counters.contains_key(&expected)
            });
        source_matches && type_matches
    }) {
        return false;
    }
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for AddCounter.
pub fn execute(
    effect: &ReplacementEffect,
    event: &mut ReplacementEvent,
    _game: &mut GameState,
    _source_card_id: CardId,
    agents: Option<&mut [Box<dyn crate::agent::PlayerAgent>]>,
) -> ReplacementResult {
    let (target, cause, is_effect, counter_map, after_replacement_static_abilities) = match event {
        ReplacementEvent::AddCounter {
            target,
            cause,
            is_effect,
            counter_map,
            after_replacement_static_abilities,
            ..
        } => (
            *target,
            cause.clone(),
            *is_effect,
            counter_map,
            after_replacement_static_abilities,
        ),
        ReplacementEvent::Moved {
            card,
            counter_map: Some(counter_map),
            counter_cause,
            counter_is_effect,
            after_replacement_static_abilities,
            ..
        } => (
            GameEntity::Card(*card),
            counter_cause.clone(),
            *counter_is_effect,
            counter_map,
            after_replacement_static_abilities,
        ),
        _ => return ReplacementResult::NotReplaced,
    };
    if let Some(replace) = effect.replace_with() {
        match replace {
            "AddOneMoreCounter" | "AddOneMoreCounters" => {
                update_matching_counters(
                    effect,
                    counter_map,
                    _game.card(_source_card_id).controller,
                    |amount| amount + 1,
                );
                return ReplacementResult::Updated;
            }
            "AddTwiceCounters" | "DoubleCounters" => {
                update_matching_counters(
                    effect,
                    counter_map,
                    _game.card(_source_card_id).controller,
                    |amount| amount * 2,
                );
                return ReplacementResult::Updated;
            }
            _ => {
                let original = counter_map.clone();
                let selected_sources =
                    selected_counter_sources(effect, &original, target, _game, agents);
                for entry in original {
                    for (counter_type, amount) in entry.counters {
                        if !entry_matches(
                            effect,
                            entry.source,
                            &counter_type,
                            _game.card(_source_card_id).controller,
                        ) {
                            continue;
                        }
                        if selected_sources.iter().any(|(selected_type, source)| {
                            *selected_type == counter_type && *source != entry.source
                        }) {
                            continue;
                        }
                        let mut single = ReplacementEvent::AddCounter {
                            target,
                            source: entry.source,
                            counter_type: counter_type.clone(),
                            count: amount,
                            counter_map: Vec::new(),
                            after_replacement_static_abilities: Vec::new(),
                            cause: cause.clone(),
                            is_effect,
                        };
                        if super::replacement_handler::execute_replace_with_numeric_update(
                            effect,
                            &mut single,
                            _game,
                            _source_card_id,
                            "CounterNum",
                        )
                        .is_some()
                        {
                            let ReplacementEvent::AddCounter { count, .. } = single else {
                                unreachable!();
                            };
                            if let Some(target_entry) = counter_map
                                .iter_mut()
                                .find(|target_entry| target_entry.source == entry.source)
                            {
                                target_entry.counters.insert(counter_type, count);
                            }
                        }
                    }
                }
                if let Some(
                    crate::replacement::replacement_effect::ReplacementChainIr::ReplaceCounter {
                        after_replacement_static_abilities: static_abilities,
                        ..
                    },
                ) = crate::replacement::replacement_effect::resolve_replace_with_chain(
                    effect,
                    _game.card(_source_card_id),
                ) {
                    if !static_abilities.is_empty() {
                        after_replacement_static_abilities
                            .push((_source_card_id, static_abilities));
                    }
                }
                return ReplacementResult::Updated;
            }
        }
    }
    ReplacementResult::Replaced
}

fn selected_counter_sources(
    effect: &ReplacementEffect,
    counter_map: &[super::replacement_handler::CounterMapValue],
    target: GameEntity,
    game: &GameState,
    mut agents: Option<&mut [Box<dyn crate::agent::PlayerAgent>]>,
) -> Vec<(crate::card::CounterType, Option<crate::ids::PlayerId>)> {
    let choose_counter = matches!(
        crate::replacement::replacement_effect::resolve_replace_with_chain(
            effect,
            game.card(effect.base().host_card_id()),
        ),
        Some(
            crate::replacement::replacement_effect::ReplacementChainIr::ReplaceCounter {
                choose_counter: true,
                ..
            }
        )
    );
    if !choose_counter || counter_map.len() <= 1 {
        return Vec::new();
    }
    let chooser = match target {
        GameEntity::Card(card) => game.card(card).controller,
        GameEntity::Player(player) => player,
    };
    let mut counter_types = Vec::new();
    for entry in counter_map {
        for counter_type in entry.counters.keys() {
            if !counter_types.contains(counter_type) {
                counter_types.push(counter_type.clone());
            }
        }
    }
    counter_types
        .into_iter()
        .filter_map(|counter_type| {
            let sources: Vec<_> = counter_map
                .iter()
                .filter(|entry| entry.counters.contains_key(&counter_type))
                .filter_map(|entry| entry.source)
                .collect();
            let source = if let Some(agents) = agents.as_deref_mut() {
                agents[chooser.index()].choose_target_player(chooser, &sources, None)
            } else {
                sources.first().copied()
            };
            source.map(|source| (counter_type, Some(source)))
        })
        .collect()
}

pub(crate) fn apply_after_replacement_static_abilities(
    game: &mut GameState,
    source_card_id: CardId,
    after_replacement_static_abilities: Vec<String>,
) {
    let source = game.card(source_card_id).clone();
    let mut effect_card = Card::new(
        CardId(0),
        format!("{}'s Effect", source.card_name),
        source.controller,
        CardTypeLine::parse("Effect"),
        ManaCost::parse("0"),
        ColorSet::COLORLESS,
        None,
        None,
        vec![],
        vec![],
    );
    effect_card.set_controller(source.controller);
    effect_card.set_effect_source(Some(source_card_id));
    effect_card.set_temp_effect_until_eot(true);
    for raw in after_replacement_static_abilities {
        if let Some(mut static_ability) =
            crate::staticability::parse_static_ability(&format!("S$ {raw}"))
        {
            static_ability.ir.active_zones = vec![ZoneType::Command];
            static_ability.ir.has_zone_keys = true;
            effect_card.add_static_ability(static_ability);
        }
    }
    for (name, value) in source.svars {
        effect_card.set_s_var_if_absent(name, value);
    }
    let effect_id = game.create_card(effect_card);
    game.move_card(effect_id, ZoneType::Command, source.controller);
}

fn entry_matches(
    effect: &ReplacementEffect,
    source: Option<crate::ids::PlayerId>,
    counter_type: &crate::card::CounterType,
    source_controller: crate::ids::PlayerId,
) -> bool {
    let source_matches = effect
        .ir
        .valid_source_selector
        .as_ref()
        .is_none_or(|valid| {
            source.is_some_and(|source| {
                valid_filter::matches_valid_player_selector(valid, source, source_controller)
            })
        });
    let type_matches = effect
        .ir
        .valid_counter_type_text
        .as_deref()
        .is_none_or(|valid| crate::ability::effects::parse_counter_type(valid) == *counter_type);
    source_matches && type_matches
}

fn update_matching_counters(
    effect: &ReplacementEffect,
    counter_map: &mut [super::replacement_handler::CounterMapValue],
    source_controller: crate::ids::PlayerId,
    update: impl Fn(i32) -> i32,
) {
    for entry in counter_map {
        for (counter_type, amount) in &mut entry.counters {
            if entry_matches(effect, entry.source, counter_type, source_controller) {
                *amount = update(*amount).max(0);
            }
        }
    }
}
