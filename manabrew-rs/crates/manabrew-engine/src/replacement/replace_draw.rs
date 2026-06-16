//! Replacement logic for `Event$ Draw`.
//!
//! Mirrors Java `ReplaceDraw.java` in `forge/game/replacement/`.

use crate::card::Card;
use crate::game::GameState;
use crate::ids::CardId;
use forge_foundation::ZoneType;

use super::replacement_effect::ReplacementEffect;
use super::replacement_handler::ReplacementEvent;
use super::replacement_result::ReplacementResult;
use super::replacement_type::ReplacementType;
use crate::card_trait_base::CardTrait;

/// Mirrors Java `ReplaceDraw.canReplace()`.
pub fn can_replace(
    effect: &ReplacementEffect,
    event: &ReplacementEvent,
    game: &GameState,
    source_card: &Card,
) -> bool {
    if effect.event != ReplacementType::Draw {
        return false;
    }
    let player = match event {
        ReplacementEvent::Draw { player, .. } => *player,
        _ => return false,
    };
    if let Some(valid) = effect.ir.valid_player_selector.as_ref() {
        if !effect.matches_compiled_valid_player(valid, player, source_card) {
            return false;
        }
    }
    // NotFirstCardInDrawStep$ True: only replace draws that are NOT the first in the draw step.
    // Used by Alhammarret's Archive to skip its first draw in the draw step.
    if effect.ir.not_first_card_in_draw_step {
        if let ReplacementEvent::Draw {
            is_first_in_draw_step,
            ..
        } = event
        {
            if *is_first_in_draw_step {
                return false;
            }
        }
    }
    // Dredge: check that the player's library has enough cards to mill.
    // Mirrors Java's CheckSVar$ DredgeCheckLib | SVarCompare$ GE{N}.
    if let Some(amount) = effect.ir.dredge_amount {
        let lib_size = game.cards_in_zone(ZoneType::Library, player).len();
        if lib_size < amount {
            return false;
        }
    }
    true
}

/// Mirrors Java `ReplacementHandler.executeReplacement()` for Draw.
pub fn execute(
    effect: &ReplacementEffect,
    _event: &mut ReplacementEvent,
    game: &mut GameState,
    source_card_id: CardId,
) -> ReplacementResult {
    if effect.prevents() || effect.has_skip() {
        return ReplacementResult::Skipped;
    }
    // ReplaceWith$ DrawTwo — draw an extra card (Alhammarret's Archive).
    if let Some(replace) = effect.replace_with() {
        if replace == "DrawTwo" || replace == "DrawExtra" {
            if let ReplacementEvent::Draw { extra_draws, .. } = _event {
                *extra_draws += 1;
                return ReplacementResult::Updated;
            }
        }
    }
    // Dredge: mill N cards from library, return this card from graveyard to hand.
    // Mirrors Java's overriding ability: DB$ Mill + DB$ ChangeZone.
    if let Some(amount) = effect.ir.dredge_amount {
        let player = match _event {
            ReplacementEvent::Draw { player, .. } => *player,
            _ => return ReplacementResult::Replaced,
        };
        // Mill N cards from library top (Rust stores top at end of vec)
        let lib = game.cards_in_zone(ZoneType::Library, player);
        let lib_len = lib.len();
        let start = lib_len.saturating_sub(amount);
        let mill_cards: Vec<crate::ids::CardId> = lib[start..].iter().rev().copied().collect();
        for cid in mill_cards {
            let owner = game.card(cid).owner;
            game.move_card(cid, ZoneType::Graveyard, owner);
        }
        // Return the Dredge card from graveyard to hand
        if game.card(source_card_id).zone == ZoneType::Graveyard {
            game.move_card(source_card_id, ZoneType::Hand, player);
        }
        return ReplacementResult::Replaced;
    }
    ReplacementResult::Replaced
}
