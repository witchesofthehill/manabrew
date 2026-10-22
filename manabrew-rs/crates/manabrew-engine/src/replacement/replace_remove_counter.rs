//! Replacement logic for `Event$ RemoveCounter`.
//!
//! Mirrors Java `ReplaceRemoveCounter.java` in `forge/game/replacement/`.

use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;

use super::replacement_effect::ReplacementEffect;
use super::replacement_handler::ReplacementEvent;
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Mirrors Java `ReplaceRemoveCounter.canReplace()`.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::RemoveCounter {
        return false;
    }
    let (target, counter_type, count) = match event {
        ReplacementEvent::RemoveCounter {
            target,
            counter_type,
            count,
        } => (*target, counter_type, *count),
        _ => return false,
    };
    let target_card = &game.cards[target.index()];
    if let Some(valid) = effect.ir.valid_card_selector.as_ref() {
        if !effect.matches_compiled_valid_card(valid, target_card, source_card) {
            return false;
        }
    }
    if effect
        .ir
        .valid_counter_type_text
        .as_deref()
        .is_some_and(|valid| crate::card::counter_type::parse_counter_type(valid) != *counter_type)
    {
        return false;
    }
    if effect.ir.is_damage == Some(true) {
        return false;
    }
    if let Some(comparator) = effect.ir.result_text.as_deref() {
        let result = (target_card.counter_count(counter_type) - count).max(0);
        if !crate::parsing::compare::compare_expr(result, comparator) {
            return false;
        }
    }
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for RemoveCounter.
pub fn execute(
    effect: &ReplacementEffect,
    event: &mut ReplacementEvent,
    game: &GameState,
    source_card_id: CardId,
) -> ReplacementResult {
    let count = match event {
        ReplacementEvent::RemoveCounter { count, .. } => count,
        _ => return ReplacementResult::NotReplaced,
    };
    if effect.layer == super::ReplacementLayer::CantHappen || effect.prevents() {
        *count = 0;
        return ReplacementResult::Prevented;
    }
    if let Some(result) = super::replacement_handler::execute_replace_with_numeric_update(
        effect,
        event,
        game,
        source_card_id,
        "Result",
    ) {
        return result;
    }
    ReplacementResult::Replaced
}

pub(crate) fn can_remove_counters(
    game: &GameState,
    card_id: CardId,
    counter_type: &crate::card::CounterType,
) -> bool {
    let card = game.card(card_id);
    !card.phased_out
        && !super::replacement_handler::cant_happen_check(
            game,
            &ReplacementEvent::RemoveCounter {
                target: card_id,
                counter_type: counter_type.clone(),
                count: card.counter_count(counter_type),
            },
        )
}
