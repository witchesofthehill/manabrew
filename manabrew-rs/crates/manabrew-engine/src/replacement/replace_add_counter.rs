//! Replacement logic for `Event$ AddCounter`.
//!
//! Mirrors Java `ReplaceAddCounter.java` in `forge/game/replacement/`.

use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;

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
    let (target, is_effect) = match event {
        ReplacementEvent::AddCounter {
            target, is_effect, ..
        } => (*target, *is_effect),
        _ => return false,
    };
    // EffectOnly$ True: only apply to counters placed by effects, not ETB keywords/game rules
    if effect.ir.effect_only && !is_effect {
        return false;
    }
    let target_card = &game.cards[target.index()];
    if let Some(valid) = effect.ir.valid_card_selector.as_ref() {
        if !effect.matches_compiled_valid_card(valid, target_card, source_card) {
            return false;
        }
    }
    // Check ValidCounterType$ — e.g. Hardened Scales only applies to P1P1 counters.
    if let Some(valid_ct) = effect.ir.valid_counter_type_text.as_deref() {
        let counter_type = match event {
            ReplacementEvent::AddCounter { counter_type, .. } => counter_type,
            _ => return false,
        };
        let expected = crate::ability::effects::parse_counter_type(valid_ct);
        if *counter_type != expected {
            return false;
        }
    }
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for AddCounter.
pub fn execute(
    effect: &ReplacementEffect,
    event: &mut ReplacementEvent,
    _game: &GameState,
    _source_card_id: CardId,
) -> ReplacementResult {
    let count = match event {
        ReplacementEvent::AddCounter { count, .. } => count,
        _ => return ReplacementResult::NotReplaced,
    };
    if let Some(replace) = effect.replace_with() {
        match replace {
            "AddOneMoreCounter" | "AddOneMoreCounters" => {
                *count += 1;
                return ReplacementResult::Updated;
            }
            "AddTwiceCounters" | "DoubleCounters" => {
                *count *= 2;
                return ReplacementResult::Updated;
            }
            _ => {
                // Try SVar chain (DB$ ReplaceCounter)
                if let Some(result) =
                    super::replacement_handler::execute_replace_with_numeric_update(
                        effect,
                        event,
                        _game,
                        _source_card_id,
                        "CounterNum",
                    )
                {
                    return result;
                }
                eprintln!(
                    "[WARN] Unknown replacement mode in AddCounter event: {:?}",
                    replace
                );
            }
        }
    }
    ReplacementResult::Replaced
}
