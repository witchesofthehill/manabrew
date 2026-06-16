//! Mill cards as a cost. Mirrors Java's `CostMill`.

use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::ids::PlayerId;

/// Pay by milling cards (library -> graveyard).
/// Mirrors Java's `CostMill.payAsDecided()`.
/// NOTE: Trigger firing (Milled, zone change) must be handled by the caller.
pub fn pay_as_decided(
    game: &mut GameState,
    player: PlayerId,
    amount: i32,
) -> Vec<crate::ids::CardId> {
    let mut milled = Vec::new();
    for _ in 0..amount {
        if let Some(top) = game.take_top_card_from_zone(ZoneType::Library, player) {
            game.move_card(top, ZoneType::Graveyard, player);
            milled.push(top);
        }
    }
    milled
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
    let super::CostPart::Mill(amount) = part else {
        return false;
    };
    let resolved = amount.resolve(game, source, player);
    let lib_size = game.zone(ZoneType::Library, player).len() as i32;
    lib_size > resolved
}

pub fn pay_with_decision(
    game: &mut GameState,
    player: PlayerId,
    source: crate::ids::CardId,
    part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    let super::CostPart::Mill(amount) = part else {
        return false;
    };
    let resolved = amount.resolve(game, source, player);
    pay_as_decided(game, player, resolved);
    true
}
