//! Replacement logic for `Event$ DrawCards`.
//!
//! Mirrors Java `ReplaceDrawCards.java` in `forge/game/replacement/`.

use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;
use crate::parsing::compare::compare_expr;
use crate::parsing::{keys, Params};

use super::replacement_effect::ReplacementEffect;
use super::replacement_handler::{
    execute_replace_with_numeric_update, resolve_replace_value, set_replacement_event_amount,
    ReplacementEvent,
};
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Mirrors Java `ReplaceDrawCards.canReplace()`.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    _game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::DrawCards {
        return false;
    }
    let (player, count) = match event {
        ReplacementEvent::DrawCards { player, count } => (*player, *count),
        _ => return false,
    };
    if count <= 0 {
        return false;
    }
    if let Some(valid) = effect.ir.valid_player_selector.as_ref() {
        if !effect.matches_compiled_valid_player(valid, player, source_card) {
            return false;
        }
    }
    if let Some(number_cmp) = effect.ir.number_text.as_deref() {
        let rhs = number_cmp
            .get(2..)
            .and_then(|n| n.parse::<i32>().ok())
            .unwrap_or(0);
        let cmp = format!("{}{}", number_cmp.get(..2).unwrap_or("GE"), rhs);
        if !compare_expr(count, &cmp) {
            return false;
        }
    }
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for DrawCards.
pub fn execute(
    effect: &ReplacementEffect,
    event: &mut ReplacementEvent,
    _game: &GameState,
    _source_card_id: CardId,
) -> ReplacementResult {
    match event {
        ReplacementEvent::DrawCards { .. } => {}
        _ => return ReplacementResult::NotReplaced,
    }
    if effect.prevents() {
        if let ReplacementEvent::DrawCards { count, .. } = event {
            *count = 0;
        }
        return ReplacementResult::Prevented;
    }
    if let Some(result) =
        execute_replace_with_numeric_update(effect, event, _game, _source_card_id, "Number")
    {
        return result;
    }
    if let Some(replace) = effect.replace_with() {
        if let Some(raw) = _game.card(_source_card_id).svars.get(replace) {
            let params = Params::from_raw(raw);
            if params.get(keys::DB) == Some("Draw") {
                let amount_expr = params.get(keys::NUM_CARDS).unwrap_or("1");
                if let Some(amount) =
                    resolve_replace_value(amount_expr, _game, _source_card_id, event)
                {
                    if set_replacement_event_amount(event, amount) {
                        return ReplacementResult::Updated;
                    }
                }
            }
        }
    }
    ReplacementResult::Replaced
}
