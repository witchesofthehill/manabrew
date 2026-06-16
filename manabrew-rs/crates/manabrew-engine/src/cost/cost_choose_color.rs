//! Choose color(s) as a cost. Mirrors Java's `CostChooseColor`.

use crate::game::GameState;
use crate::ids::CardId;

/// Pay by setting chosen colors on the source card.
/// Mirrors Java's `CostChooseColor.payAsDecided()` →
/// `sa.getHostCard().setChosenColors(colors)`.
pub fn pay_as_decided(game: &mut GameState, source: CardId, colors: &[String]) -> bool {
    game.card_mut(source).chosen_colors = colors.to_vec();
    true
}

/// Refund by clearing chosen colors.
/// Mirrors Java's `CostChooseColor.refund()`.
pub fn refund(game: &mut GameState, source: CardId) {
    game.card_mut(source).chosen_colors.clear();
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
    game: &mut GameState,
    _player: crate::ids::PlayerId,
    source: CardId,
    _part: &super::CostPart,
    decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    if let crate::cost::payment_decision::PaymentDecision::Colors(colors) = decision {
        let names: Vec<String> = colors.iter().map(|c| c.long_name().to_string()).collect();
        return pay_as_decided(game, source, &names);
    }
    false
}
