//! Roll dice as a cost. Mirrors Java's `CostRollDice`.
//!
//! Java's `CostRollDice.payAsDecided()` calls `RollDiceEffect.rollDiceForPlayer()`.
//! In Rust, dice rolling + trigger firing is handled by the caller since it
//! requires RNG and trigger handler access.

// NOTE: pay_as_decided is handled inline in game_action.rs because it requires
// RNG (game_rng) and trigger handler access for RolledDie/RolledDieOnce triggers.
// See game_action.rs CostPart::RollDice match arm.

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

pub fn pay_as_decided() -> bool {
    true
}

pub fn pay_with_decision(
    _game: &mut crate::game::GameState,
    _player: crate::ids::PlayerId,
    _source: crate::ids::CardId,
    _part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    true
}
