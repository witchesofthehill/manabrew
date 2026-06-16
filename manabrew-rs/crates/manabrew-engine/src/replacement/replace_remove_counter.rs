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
    let target = match event {
        ReplacementEvent::RemoveCounter { target, .. } => *target,
        _ => return false,
    };
    let target_card = &game.cards[target.index()];
    if let Some(valid) = effect.ir.valid_card_selector.as_ref() {
        if !effect.matches_compiled_valid_card(valid, target_card, source_card) {
            return false;
        }
    }
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for RemoveCounter.
pub fn execute(
    effect: &ReplacementEffect,
    event: &mut ReplacementEvent,
    _game: &GameState,
    _source_card_id: CardId,
) -> ReplacementResult {
    let count = match event {
        ReplacementEvent::RemoveCounter { count, .. } => count,
        _ => return ReplacementResult::NotReplaced,
    };
    if effect.prevents() {
        *count = 0;
        return ReplacementResult::Prevented;
    }
    ReplacementResult::Replaced
}
