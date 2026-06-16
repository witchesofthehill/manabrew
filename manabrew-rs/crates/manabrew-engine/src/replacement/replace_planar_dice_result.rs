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
    let player = match event {
        ReplacementEvent::PlanarDiceResult { player } => *player,
        _ => return false,
    };
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
    _event: &mut ReplacementEvent,
    _game: &GameState,
    _source_card_id: CardId,
) -> ReplacementResult {
    if effect.prevents() || effect.has_skip() {
        return ReplacementResult::Skipped;
    }
    ReplacementResult::Replaced
}
