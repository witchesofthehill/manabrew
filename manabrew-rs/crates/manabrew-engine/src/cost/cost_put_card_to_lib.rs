//! Put cards to library as a cost. Mirrors Java's `CostPutCardToLib`.
//!
//! Covers PutCardToLibFromHand, PutCardToLibFromGrave, PutCardToLibFromSameGrave.
//! Java uses `from` zone and `sameZone` flag to distinguish variants.

use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::ids::CardId;

/// Execute put-to-library for self (CARDNAME/NICKNAME).
/// Mirrors Java's `CostPutCardToLib.doPayment()` for self.
pub fn pay_as_decided_self(game: &mut GameState, source: CardId, lib_pos: i32) -> bool {
    let owner = game.card(source).owner;
    if lib_pos == 0 {
        game.move_card(source, ZoneType::Library, owner);
    } else {
        game.put_on_bottom_of_library(source, owner);
    }
    true
}

/// Execute put-to-library for selected cards.
/// Mirrors Java's `CostPutCardToLib.doPayment()`.
pub fn pay_as_decided_cards(game: &mut GameState, cards: &[CardId], lib_pos: i32) -> bool {
    for &cid in cards {
        let owner = game.card(cid).owner;
        if lib_pos == 0 {
            game.move_card(cid, ZoneType::Library, owner);
        } else {
            game.put_on_bottom_of_library(cid, owner);
        }
    }
    true
}

pub const HASH_LKI: &str = "CardPutToLib";
pub const HASH_CARDS: &str = "CardPutToLibCards";

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
    let super::CostPart::PutCardToLib {
        amount,
        type_filter,
        from,
        same_zone,
        ..
    } = part
    else {
        return false;
    };
    let resolved_amount = amount.resolve(game, source, player);
    if type_filter == "CARDNAME" || type_filter == "NICKNAME" {
        if *same_zone {
            return game
                .players
                .iter()
                .any(|p| game.cards_in_zone(*from, p.id).contains(&source));
        }
        return game.card(source).zone == *from;
    }
    if *same_zone {
        let pool: Vec<CardId> = game
            .players
            .iter()
            .flat_map(|p| game.cards_in_zone(*from, p.id).to_vec())
            .filter(|&cid| {
                type_filter == "Card"
                    || type_filter.is_empty()
                    || crate::ability::effects::matches_change_type(
                        game.card(cid),
                        type_filter,
                        &[],
                    )
            })
            .collect();
        let mut by_controller: std::collections::HashMap<crate::ids::PlayerId, i32> =
            std::collections::HashMap::new();
        for cid in pool {
            let ctrl = game.card(cid).controller;
            *by_controller.entry(ctrl).or_insert(0) += 1;
        }
        return by_controller.values().any(|&v| v >= resolved_amount);
    }
    let count = super::get_zone_targets(game, player, *from, type_filter).len() as i32;
    count >= resolved_amount
}

pub fn pay_with_decision(
    game: &mut GameState,
    _player: crate::ids::PlayerId,
    source: CardId,
    part: &super::CostPart,
    decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    let super::CostPart::PutCardToLib {
        lib_pos,
        type_filter,
        ..
    } = part
    else {
        return false;
    };
    if type_filter == "CARDNAME" || type_filter == "NICKNAME" {
        return pay_as_decided_self(game, source, *lib_pos);
    }
    if let crate::cost::payment_decision::PaymentDecision::Cards(cards) = decision {
        return pay_as_decided_cards(game, cards, *lib_pos);
    }
    false
}
