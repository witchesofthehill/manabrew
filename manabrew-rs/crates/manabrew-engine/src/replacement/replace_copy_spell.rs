//! Replacement logic for `Event$ CopySpell`.
//!
//! Mirrors Java `ReplaceCopySpell.java` in `forge/game/replacement/`.

use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;

use super::replacement_effect::ReplacementEffect;
use super::replacement_handler::ReplacementEvent;
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Mirrors Java `ReplaceCopySpell.canReplace()`.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    _game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::CopySpell {
        return false;
    }
    let (player, count) = match event {
        ReplacementEvent::CopySpell { player, count } => (*player, *count),
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
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for CopySpell.
pub fn execute(
    effect: &ReplacementEffect,
    event: &mut ReplacementEvent,
    _game: &GameState,
    _source_card_id: CardId,
) -> ReplacementResult {
    let count = match event {
        ReplacementEvent::CopySpell { count, .. } => count,
        _ => return ReplacementResult::NotReplaced,
    };
    if effect.prevents() {
        *count = 0;
        return ReplacementResult::Prevented;
    }
    ReplacementResult::Replaced
}
