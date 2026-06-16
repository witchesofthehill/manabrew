//! Have an opponent gain life as a cost. Mirrors Java's `CostGainLife`.

use crate::game::GameState;
use crate::ids::PlayerId;

/// Pay by having the opponent gain life.
/// Mirrors Java's `CostGainLife.payAsDecided()`.
pub fn pay_as_decided(game: &mut GameState, player: PlayerId, amount: i32) -> bool {
    let opponent = game.opponent_of(player);
    game.player_gain_life(opponent, amount);
    true
}

pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    _source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    _ability: Option<&crate::spellability::SpellAbility>,
    _part: &super::CostPart,
) -> bool {
    let opponent = game.opponent_of(player);
    !crate::staticability::static_ability_cant_gain_lose_pay_life::cant_gain_life(game, opponent)
}

pub fn pay_with_decision(
    game: &mut GameState,
    player: PlayerId,
    source: crate::ids::CardId,
    part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    let super::CostPart::GainLife(amount) = part else {
        return false;
    };
    pay_as_decided(game, player, amount.resolve(game, source, player))
}
