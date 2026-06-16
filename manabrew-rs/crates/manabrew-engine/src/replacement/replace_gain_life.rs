//! Replacement logic for `Event$ GainLife`.
//!
//! Mirrors Java `ReplaceGainLife.java` in `forge/game/replacement/`.

use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;
use crate::parsing::compare::compare_expr;

use super::replacement_effect::ReplacementEffect;
use super::replacement_handler::{execute_replace_with_numeric_update, ReplacementEvent};
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Mirrors Java `ReplaceGainLife.canReplace()`.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    _game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::GainLife {
        return false;
    }
    let (player, amount) = match event {
        ReplacementEvent::GainLife { player, amount } => (*player, *amount),
        _ => return false,
    };
    if amount <= 0 {
        return false;
    }
    if let Some(valid) = effect.ir.valid_player_selector.as_ref() {
        if !effect.matches_compiled_valid_player(valid, player, source_card) {
            return false;
        }
    }
    if let Some(amount_cmp) = effect.ir.amount_text.as_deref() {
        let rhs = amount_cmp
            .get(2..)
            .and_then(|n| n.parse::<i32>().ok())
            .unwrap_or(0);
        let cmp = format!("{}{}", amount_cmp.get(..2).unwrap_or("GE"), rhs);
        if !compare_expr(amount, &cmp) {
            return false;
        }
    }
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for GainLife.
pub fn execute(
    effect: &ReplacementEffect,
    event: &mut ReplacementEvent,
    _game: &GameState,
    _source_card_id: CardId,
) -> ReplacementResult {
    match event {
        ReplacementEvent::GainLife { .. } => {}
        _ => return ReplacementResult::NotReplaced,
    }
    if effect.prevents() {
        if let ReplacementEvent::GainLife { amount, .. } = event {
            *amount = 0;
        }
        return ReplacementResult::Skipped;
    }
    // Handle built-in replacement modes before SVar chain.
    if let Some(replace) = effect.replace_with() {
        match replace {
            "GainDouble" => {
                if let ReplacementEvent::GainLife { amount, .. } = event {
                    *amount *= 2;
                    return ReplacementResult::Updated;
                }
            }
            "NoLife" => {
                if let ReplacementEvent::GainLife { amount, .. } = event {
                    *amount = 0;
                    return ReplacementResult::Skipped;
                }
            }
            _ => {}
        }
    }
    if let Some(result) =
        execute_replace_with_numeric_update(effect, event, _game, _source_card_id, "LifeGained")
    {
        return result;
    }
    ReplacementResult::Replaced
}
