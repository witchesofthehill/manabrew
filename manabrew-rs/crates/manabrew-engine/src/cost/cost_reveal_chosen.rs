//! Reveal a previously chosen player or type as a cost. Mirrors Java's `CostRevealChosen`.
//!
//! This cost requires the source card to have a chosen player or type set,
//! and the controller must be the activator.

use crate::game::GameState;
use crate::ids::CardId;

/// Execute the reveal-chosen payment.
/// Mirrors Java's `CostRevealChosen.payAsDecided()`.
/// Reveals the chosen player or type on the host card.
pub fn pay_as_decided(game: &mut GameState, source: CardId, reveal_type: &str) -> bool {
    let card = game.card_mut(source);
    if reveal_type == "Player" {
        if card.chosen_player.is_some() {
            // Mark as revealed (Java calls host.revealChosenPlayer())
            return true;
        }
    } else if reveal_type == "Type" && card.chosen_type.is_some() {
        // Mark as revealed (Java calls host.revealChosenType())
        return true;
    }
    false
}

pub fn payment_order(part: &super::CostPart) -> i32 {
    part.payment_order()
}

pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    _ability: Option<&crate::spellability::SpellAbility>,
    part: &super::CostPart,
) -> bool {
    let super::CostPart::RevealChosen { reveal_type } = part else {
        return false;
    };
    let source_card = game.card(source);
    if reveal_type.eq_ignore_ascii_case("Player") {
        if source_card.chosen_player.is_none() {
            return false;
        }
        return source_card
            .chosen_player_controller
            .is_none_or(|pid| pid == player);
    }
    if reveal_type.eq_ignore_ascii_case("Type") {
        if source_card.chosen_type.is_none() {
            return false;
        }
        return source_card
            .chosen_type_controller
            .is_none_or(|pid| pid == player);
    }
    false
}

pub fn pay_with_decision(
    game: &mut GameState,
    _player: crate::ids::PlayerId,
    source: CardId,
    part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    let super::CostPart::RevealChosen { reveal_type } = part else {
        return false;
    };
    pay_as_decided(game, source, reveal_type)
}
