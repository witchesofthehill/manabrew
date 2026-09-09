//! Replacement logic for `Event$ PlanarDiceResult`.
//!
//! Mirrors Java `ReplacePlanarDiceResult.java` in `forge/game/replacement/`.

use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;

use super::replacement_effect::ReplacementEffect;
use super::replacement_handler::ReplacementEvent;
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Mirrors Java `ReplacePlanarDiceResult.canReplace()`.
/// Java checks `ValidRoll`; we check `ValidPlayer` as the primary filter.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    _game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::PlanarDiceResult {
        return false;
    }
    let (player, result) = match event {
        ReplacementEvent::PlanarDiceResult { player, result } => (*player, *result),
        _ => return false,
    };
    if let Some(valid) = effect.ir.valid_roll_text.as_deref() {
        if crate::agent::notification::PlanarDieFace::parse(valid) != Some(result) {
            return false;
        }
    }
    if let Some(valid) = effect.ir.valid_player_selector.as_ref() {
        if !effect.matches_compiled_valid_player(valid, player, source_card) {
            return false;
        }
    }
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for PlanarDiceResult.
pub fn execute(
    effect: &ReplacementEffect,
    event: &mut ReplacementEvent,
    game: &GameState,
    source_card_id: CardId,
) -> ReplacementResult {
    if effect.prevents() || effect.has_skip() {
        return ReplacementResult::Skipped;
    }
    if let Some(chain) =
        super::replacement_effect::resolve_replace_with_chain(effect, game.card(source_card_id))
    {
        if let Some(result) = super::replacement_handler::execute_replace_effect_ir(
            &chain,
            event,
            game,
            source_card_id,
            Some("Result"),
        ) {
            return result;
        }
    }
    ReplacementResult::Replaced
}
