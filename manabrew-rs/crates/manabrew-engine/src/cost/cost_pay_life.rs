//! Pay life as a cost. Mirrors Java's `CostPayLife`.

use crate::game::GameState;
use crate::ids::PlayerId;

/// Pay the life cost.
/// Mirrors Java's `CostPayLife.payAsDecided()` → `player.payLife(amount, ability, effect)`.
/// NOTE: Trigger firing (LifeLost) must be handled by the caller.
pub fn pay_as_decided(game: &mut GameState, player: PlayerId, amount: i32) -> bool {
    if amount <= 0 {
        return true;
    }
    game.player_lose_life(player, amount);
    // TODO: Fire LifeLost trigger — Java's player.payLife() fires LoseLife trigger.
    // Currently handled by GameLoop::pay_life_cost() which also checks cant_pay_life.
    true
}

/// No refund for life payment.
/// Java's CostPayLife does not override refund().
pub fn refund(_game: &mut GameState, _player: PlayerId, _amount: i32) {
    // Life payment is not refundable in Java.
    // The transactional snapshot handles rollback.
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
    let super::CostPart::PayLife(amount) = part else {
        return false;
    };
    let resolved_amount = amount.resolve(game, source, player);
    if crate::staticability::static_ability_cant_gain_lose_pay_life::cant_pay_life(
        game, player, true, None,
    ) {
        return false;
    }
    game.player(player).life >= resolved_amount
}

pub fn pay_with_decision(
    game: &mut GameState,
    player: PlayerId,
    source: crate::ids::CardId,
    part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    let super::CostPart::PayLife(amount) = part else {
        return false;
    };
    let resolved = amount.resolve(game, source, player);
    pay_as_decided(game, player, resolved)
}
