//! Replacement logic for `Event$ Attached`.
//!
//! Mirrors Java `ReplaceAttached.java` in `forge/game/replacement/`.

use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;

use super::replacement_effect::ReplacementEffect;
use super::replacement_handler::ReplacementEvent;
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Mirrors Java `ReplaceAttached.canReplace()`.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::Attached {
        return false;
    }
    let (card, target) = match event {
        ReplacementEvent::Attached { card, target } => (*card, *target),
        _ => return false,
    };
    let attach_card = &game.cards[card.index()];
    if let Some(valid) = effect.ir.valid_card_selector.as_ref() {
        if !effect.matches_compiled_valid_card(valid, attach_card, source_card) {
            return false;
        }
    }
    let target_card = &game.cards[target.index()];
    if let Some(valid_target) = effect.ir.valid_target_selector.as_ref() {
        if !effect.matches_compiled_valid_card(valid_target, target_card, source_card) {
            return false;
        }
    }
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for Attached.
pub fn execute(
    effect: &ReplacementEffect,
    _event: &mut ReplacementEvent,
    _game: &GameState,
    _source_card_id: CardId,
) -> ReplacementResult {
    if effect.prevents() || effect.has_skip() {
        return ReplacementResult::Skipped;
    }
    ReplacementResult::Replaced
}
