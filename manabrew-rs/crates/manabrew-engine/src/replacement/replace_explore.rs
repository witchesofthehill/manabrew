//! Replacement logic for `Event$ Explore`.
//!
//! Mirrors Java `ReplaceExplore.java` in `forge/game/replacement/`.

use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;

use super::replacement_effect::ReplacementEffect;
use super::replacement_handler::ReplacementEvent;
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Mirrors Java `ReplaceExplore.canReplace()`.
/// Java checks `ValidExplorer` using the same pattern as `ValidCard`.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::Explore {
        return false;
    }
    let card = match event {
        ReplacementEvent::Explore { card } => *card,
        _ => return false,
    };
    let target_card = &game.cards[card.index()];
    // Java uses ValidExplorer with the same semantics as ValidCard.
    if let Some(valid) = effect.ir.valid_explorer_text.as_deref() {
        if !effect.matches_valid_card(valid, target_card, source_card) {
            return false;
        }
    } else if let Some(valid) = effect.ir.valid_card_selector.as_ref() {
        if !effect.matches_compiled_valid_card(valid, target_card, source_card) {
            return false;
        }
    }
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for Explore.
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
