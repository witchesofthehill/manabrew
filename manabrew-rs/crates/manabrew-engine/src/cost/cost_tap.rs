//! Tap the source permanent as a cost. Mirrors Java's `CostTap`.

use crate::game::GameState;
use crate::ids::CardId;

/// Pay the tap cost by tapping the source.
/// Mirrors Java's `CostTap.payAsDecided()`.
/// NOTE: Trigger firing (TapAll) is handled by the caller (GameLoop) since
/// it requires access to the trigger handler which is not available here.
pub fn pay_as_decided(game: &mut GameState, source: CardId) -> bool {
    game.tap(source);
    true
}

/// Refund the tap cost by untapping the source.
/// Mirrors Java's `CostTap.refund()`.
pub fn refund(game: &mut GameState, source: CardId) {
    game.untap(source);
}

pub fn payment_order(part: &super::CostPart) -> i32 {
    part.payment_order()
}

pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    source: crate::ids::CardId,
    _player: crate::ids::PlayerId,
    _ability: Option<&crate::spellability::SpellAbility>,
    _part: &super::CostPart,
) -> bool {
    let card = game.card(source);
    if card.tapped || card.phased_out {
        return false;
    }
    !(card.is_creature() && card.summoning_sick && !card.has_haste())
}

pub fn pay_with_decision(
    game: &mut GameState,
    _player: crate::ids::PlayerId,
    source: CardId,
    _part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    pay_as_decided(game, source)
}
