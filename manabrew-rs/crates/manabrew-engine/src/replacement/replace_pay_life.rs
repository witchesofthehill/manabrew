//! Replacement logic for `Event$ PayLife`.
//!
//! Mirrors Java `ReplacePayLife.java` in `forge/game/replacement/`.

use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;
use crate::parsing::compare::compare_expr;

use super::replacement_effect::ReplacementEffect;
use super::replacement_handler::{
    execute_replace_with_numeric_update, resolve_replace_value, ReplacementEvent,
};
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Mirrors Java `ReplacePayLife.canReplace()`.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    _game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::PayLife {
        return false;
    }
    let (player, amount) = match event {
        ReplacementEvent::PayLife { player, amount } => (*player, *amount),
        _ => return false,
    };
    if let Some(valid) = effect.ir.valid_player_selector.as_ref() {
        if !effect.matches_compiled_valid_player(valid, player, source_card) {
            return false;
        }
    }
    if let Some(amount_cmp) = effect.ir.amount_text.as_deref() {
        let threshold = amount_cmp.get(2..).unwrap_or("");
        let rhs = resolve_replace_value(threshold, _game, source_card.id, event)
            .or_else(|| threshold.parse::<i32>().ok())
            .unwrap_or(0);
        let cmp = format!("{}{}", amount_cmp.get(..2).unwrap_or("GE"), rhs);
        if !compare_expr(amount, &cmp) {
            return false;
        }
    }
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for PayLife.
pub fn execute(
    effect: &ReplacementEffect,
    event: &mut ReplacementEvent,
    _game: &GameState,
    _source_card_id: CardId,
) -> ReplacementResult {
    match event {
        ReplacementEvent::PayLife { .. } => {}
        _ => return ReplacementResult::NotReplaced,
    }
    if effect.prevents() {
        if let ReplacementEvent::PayLife { amount, .. } = event {
            *amount = 0;
        }
        return ReplacementResult::Prevented;
    }
    if let Some(result) =
        execute_replace_with_numeric_update(effect, event, _game, _source_card_id, "Amount")
    {
        return result;
    }
    ReplacementResult::Replaced
}
