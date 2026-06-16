//! Pay energy counters as a cost. Mirrors Java's `CostPayEnergy`.

use crate::game::GameState;
use crate::ids::PlayerId;

/// Pay by removing energy counters.
/// Mirrors Java's `CostPayEnergy.payAsDecided()` → `player.payEnergy(amount)`.
pub fn pay_as_decided(game: &mut GameState, player: PlayerId, amount: i32) -> bool {
    game.player_add_energy(player, -amount);
    true
}

/// Refund energy payment.
/// Mirrors Java's `CostPayEnergy.refund()` → `source.getController().loseEnergy(-amount)`.
pub fn refund(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_add_energy(player, amount);
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
    let super::CostPart::PayEnergy(amount) = part else {
        return false;
    };
    game.player(player).energy_counters >= amount.resolve(game, source, player)
}

pub fn pay_with_decision(
    game: &mut GameState,
    player: PlayerId,
    source: crate::ids::CardId,
    part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    let super::CostPart::PayEnergy(amount) = part else {
        return false;
    };
    let resolved = amount.resolve(game, source, player);
    pay_as_decided(game, player, resolved)
}
