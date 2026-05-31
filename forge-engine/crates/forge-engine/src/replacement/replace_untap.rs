//! Replacement logic for `Event$ Untap`.
//!
//! Mirrors Java `ReplaceUntap.java` in `forge/game/replacement/`.

use crate::card::{valid_filter, Card};
use crate::game::GameState;
use crate::ids::CardId;

use super::replacement_effect::ReplacementEffect;
use super::replacement_handler::ReplacementEvent;
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Mirrors Java `ReplaceUntap.canReplace()`.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::Untap {
        return false;
    }
    let (card, player) = match event {
        ReplacementEvent::Untap { card, player } => (*card, *player),
        _ => return false,
    };
    let target_card = &game.cards[card.index()];
    if let Some(valid) = effect.ir.valid_card_selector.as_ref() {
        if !effect.matches_compiled_valid_card(valid, target_card, source_card) {
            return false;
        }
    }
    if let Some(valid) = effect.ir.valid_step_turn_to_controller_text.as_deref() {
        let Some(player) = player else {
            return false;
        };
        if !valid_filter::matches_valid_player(valid, player, target_card.controller) {
            return false;
        }
    }
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for Untap.
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
