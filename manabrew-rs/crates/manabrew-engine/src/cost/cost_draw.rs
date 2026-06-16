//! Draw cards as a cost. Mirrors Java's `CostDraw`.

use crate::game::GameState;
use crate::ids::PlayerId;

/// Pay by drawing cards.
/// Mirrors Java's `CostDraw.payAsDecided()`.
pub fn pay_as_decided(game: &mut GameState, player: PlayerId, amount: i32) -> bool {
    for _ in 0..amount {
        game.draw_card(player);
    }
    true
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
    let super::CostPart::Draw(amount) = part else {
        return false;
    };
    let resolved = amount.resolve(game, source, player);
    let allowed =
        crate::staticability::static_ability_cant_draw::can_draw_amount(game, player, resolved);
    allowed >= resolved
}

pub fn pay_with_decision(
    game: &mut GameState,
    player: PlayerId,
    source: crate::ids::CardId,
    part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    let super::CostPart::Draw(amount) = part else {
        return false;
    };
    let resolved = amount.resolve(game, source, player);
    pay_as_decided(game, player, resolved)
}
