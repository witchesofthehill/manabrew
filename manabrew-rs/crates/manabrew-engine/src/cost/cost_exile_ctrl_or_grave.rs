//! Exile from controlled battlefield or graveyard as a combined cost.
//! Used by Craft abilities. No direct Java CostExileCtrlOrGrave class — this is
//! a Rust-side variant that combines CostExile battlefield + graveyard sources.

use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::ids::CardId;

/// Execute exile payment for selected cards.
/// Cards may come from battlefield or graveyard.
pub fn pay_as_decided_cards(game: &mut GameState, cards: &[CardId]) -> bool {
    for &cid in cards {
        let owner = game.card(cid).owner;
        game.move_card(cid, ZoneType::Exile, owner);
    }
    true
}

pub const HASH_LKI: &str = "ExiledCtrlOrGrave";
pub const HASH_CARDS: &str = "ExiledCtrlOrGraveCards";

pub fn can_pay(
    game: &crate::game::GameState,
    source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    ability: Option<&crate::spellability::SpellAbility>,
    part: &super::CostPart,
) -> bool {
    let super::CostPart::ExileCtrlOrGrave {
        amount,
        type_filter,
    } = part
    else {
        return false;
    };
    let resolved_amount = amount.resolve(game, source, player);
    let static_source_cards = super::static_ability_source_cards(game);
    let base_filter = super::normalize_exile_base_filter(type_filter);
    let bf = super::get_zone_targets(game, player, ZoneType::Battlefield, &base_filter)
        .into_iter()
        .filter(|&cid| {
            !crate::staticability::static_ability_cant_exile::cant_exile(
                &static_source_cards,
                game.card(cid),
                ability,
                true,
            )
        })
        .count();
    let gy = super::get_zone_targets(game, player, ZoneType::Graveyard, &base_filter)
        .into_iter()
        .filter(|&cid| {
            !crate::staticability::static_ability_cant_exile::cant_exile(
                &static_source_cards,
                game.card(cid),
                ability,
                true,
            )
        })
        .count();
    ((bf + gy) as i32) >= resolved_amount
}

pub fn pay_with_decision(
    game: &mut GameState,
    _player: crate::ids::PlayerId,
    _source: crate::ids::CardId,
    _part: &super::CostPart,
    decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    if let crate::cost::payment_decision::PaymentDecision::Cards(cards) = decision {
        return pay_as_decided_cards(game, cards);
    }
    false
}
