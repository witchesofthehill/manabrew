//! Replacement logic for `Event$ RollDice`.
//!
//! Mirrors Java `ReplaceRollDice.java` in `forge/game/replacement/`.

use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;

use super::replacement_effect::resolve_replace_with_chain;
use super::replacement_effect::ReplacementEffect;
use super::replacement_handler::{
    execute_replace_effect_ir, execute_replace_with_numeric_update, resolve_replace_value,
    ReplacementEvent,
};
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Mirrors Java `ReplaceRollDice.canReplace()`.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    _game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::RollDice {
        return false;
    }
    let (player, sides) = match event {
        ReplacementEvent::RollDice { player, sides, .. } => (*player, *sides),
        _ => return false,
    };
    if let Some(valid) = effect.ir.valid_player_selector.as_ref() {
        if !effect.matches_compiled_valid_player(valid, player, source_card) {
            return false;
        }
    }
    if let Some(valid_sides) = effect.ir.valid_sides_text.as_deref() {
        let rhs = resolve_replace_value(valid_sides, _game, source_card.id, event)
            .or_else(|| valid_sides.parse::<i32>().ok())
            .unwrap_or(0);
        if sides != rhs {
            return false;
        }
    }
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for RollDice.
pub fn execute(
    effect: &ReplacementEffect,
    _event: &mut ReplacementEvent,
    _game: &GameState,
    _source_card_id: CardId,
) -> ReplacementResult {
    if effect.prevents() || effect.has_skip() {
        return ReplacementResult::Skipped;
    }
    if let Some(result) =
        execute_replace_with_numeric_update(effect, _event, _game, _source_card_id, "Number")
    {
        return result;
    }
    if let Some(result) =
        execute_replace_with_numeric_update(effect, _event, _game, _source_card_id, "Ignore")
    {
        return result;
    }
    if let Some(replace_with) = resolve_replace_with_chain(effect, _game.card(_source_card_id)) {
        if let Some(result) = execute_replace_effect_ir(
            &replace_with,
            _event,
            _game,
            _source_card_id,
            Some("IgnoreChosen"),
        ) {
            return result;
        }
        if let Some(result) = execute_replace_effect_ir(
            &replace_with,
            _event,
            _game,
            _source_card_id,
            Some("DicePTExchanges"),
        ) {
            return result;
        }
    }
    ReplacementResult::Replaced
}
