//! Enlist a creature as a cost. Mirrors Java's `CostEnlist`.

// NOTE: pay_as_decided is handled by GameLoop::pay_enlist_cost() in game_action.rs
// because it requires agent interaction, tapping, power transfer, and trigger firing (Enlisted).

pub const HASH_LKI: &str = "Enlisted";
pub const HASH_CARDS: &str = "EnlistedCards";

pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    _source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    _ability: Option<&crate::spellability::SpellAbility>,
    _part: &super::CostPart,
) -> bool {
    !super::get_enlist_targets(game, player).is_empty()
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
