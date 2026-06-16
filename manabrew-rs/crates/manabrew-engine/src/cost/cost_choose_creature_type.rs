//! Choose a creature type as a cost. Mirrors Java's `CostChooseCreatureType`.

use crate::game::GameState;
use crate::ids::{CardId, PlayerId};

/// Pay by setting chosen type on the source card.
/// Mirrors Java's `CostChooseCreatureType.payAsDecided()` →
/// `sa.getHostCard().setChosenType(pd.type)`.
pub fn pay_as_decided(
    game: &mut GameState,
    source: CardId,
    player: PlayerId,
    chosen_type: &str,
) -> bool {
    let card = game.card_mut(source);
    card.chosen_type = Some(chosen_type.to_string());
    card.chosen_type_controller = Some(player);
    card.chosen_type_revealed = false;
    true
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
    player: PlayerId,
    source: CardId,
    _part: &super::CostPart,
    decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    if let crate::cost::payment_decision::PaymentDecision::Type(t) = decision {
        return pay_as_decided(game, source, player, t);
    }
    false
}
