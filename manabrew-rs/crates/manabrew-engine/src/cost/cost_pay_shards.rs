//! Pay mana shards as a cost. Mirrors Java's `CostPayShards`.

use crate::game::GameState;
use crate::ids::PlayerId;

pub fn pay_as_decided(game: &mut GameState, player: PlayerId, amount: i32) -> bool {
    game.player_add_shards(player, -amount);
    true
}

pub fn refund(game: &mut GameState, player: PlayerId, amount: i32) {
    game.player_add_shards(player, amount);
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
    let super::CostPart::PayShards(amount) = part else {
        return false;
    };
    let resolved_amount = amount.resolve(game, source, player);
    game.player(player).mana_shards >= resolved_amount
}

pub fn pay_with_decision(
    game: &mut GameState,
    player: PlayerId,
    source: crate::ids::CardId,
    part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    let super::CostPart::PayShards(amount) = part else {
        return false;
    };
    let resolved = amount.resolve(game, source, player);
    pay_as_decided(game, player, resolved)
}
