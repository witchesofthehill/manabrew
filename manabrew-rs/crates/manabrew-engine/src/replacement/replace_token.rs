//! Replacement logic for `Event$ CreateToken`.
//!
//! Mirrors Java `ReplaceToken.java` in `forge/game/replacement/`.

use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;

use super::replacement_effect::ReplacementEffect;
use super::replacement_handler::{execute_replace_with_numeric_update, ReplacementEvent};
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Apply the token amount filter based on the effect's `ReplaceWith$` param.
///
/// - `"AddOneMoreToken"` → base_amount + 1
/// - `"DoubleTokens"` → base_amount * 2
/// - anything else → base_amount unchanged
///
/// Mirrors Java `ReplaceToken.filterAmount()`.
pub fn filter_amount(effect: &ReplacementEffect, base_amount: i32) -> i32 {
    match effect.replace_with() {
        Some(s) if s == "AddOneMoreToken" || s == "AddOneMoreTokens" => base_amount + 1,
        Some("DoubleTokens") => base_amount * 2,
        _ => base_amount,
    }
}

/// Mirrors Java `ReplaceToken.canReplace()`.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    _game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::CreateToken {
        return false;
    }
    let (player, is_effect) = match event {
        ReplacementEvent::CreateToken {
            player, is_effect, ..
        } => (*player, *is_effect),
        _ => return false,
    };
    // EffectOnly$ True: only apply to tokens created by effects, not game rules
    if effect.ir.effect_only && !is_effect {
        return false;
    }
    if let Some(valid) = effect.ir.valid_player_selector.as_ref() {
        if !effect.matches_compiled_valid_player(valid, player, source_card) {
            return false;
        }
    }
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for CreateToken.
pub fn execute(
    effect: &ReplacementEffect,
    event: &mut ReplacementEvent,
    _game: &GameState,
    _source_card_id: CardId,
) -> ReplacementResult {
    match event {
        ReplacementEvent::CreateToken { .. } => {}
        _ => return ReplacementResult::NotReplaced,
    }
    if let Some(result) =
        execute_replace_with_numeric_update(effect, event, _game, _source_card_id, "TokenNum")
    {
        return result;
    }
    ReplacementResult::Replaced
}
