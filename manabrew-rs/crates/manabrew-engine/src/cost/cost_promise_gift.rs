//! Promise a gift to an opponent as a cost. Mirrors Java's `CostPromiseGift`.
//!
//! The player chooses an opponent to receive the gift. The chosen opponent
//! is stored on the host card via `set_promised_gift()`.

use crate::game::GameState;
use crate::ids::{CardId, PlayerId};

/// Execute the promise gift payment.
/// Mirrors Java's `CostPromiseGift.payAsDecided()`.
/// Sets the promised gift recipient on the host card.
pub fn pay_as_decided(game: &mut GameState, source: CardId, recipient: Option<PlayerId>) -> bool {
    match recipient {
        Some(pid) => {
            game.card_mut(source).promised_gift = Some(pid);
            true
        }
        None => {
            game.card_mut(source).promised_gift = None;
            false
        }
    }
}

/// Get potential gift recipients (opponents of payer).
pub fn get_potential_players(game: &GameState, payer: PlayerId) -> Vec<PlayerId> {
    game.alive_players()
        .into_iter()
        .filter(|&pid| pid != payer)
        .collect()
}

pub fn payment_order(part: &super::CostPart) -> i32 {
    part.payment_order()
}

pub fn can_pay(
    _game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    _source: crate::ids::CardId,
    _player: crate::ids::PlayerId,
    _ability: Option<&crate::spellability::SpellAbility>,
    _part: &super::CostPart,
) -> bool {
    true
}

pub fn pay_with_decision(
    _game: &mut GameState,
    _player: PlayerId,
    _source: CardId,
    _part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    true
}
