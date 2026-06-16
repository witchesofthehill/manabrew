//! Discard cards as a cost. Mirrors Java's `CostDiscard`.
//!
//! Java's `CostDiscard` extends `CostPartWithList` and uses `doPayment()`
//! to call `payer.discard(targetCard, ...)`. It also fires `DiscardedAll`
//! trigger after all discards.

use forge_foundation::ZoneType;

use crate::game::GameState;
use crate::ids::{CardId, PlayerId};

/// Execute discard of self (CARDNAME).
/// Mirrors Java's `CostDiscard.doPayment()` for self-discard.
pub fn pay_as_decided_self(game: &mut GameState, source: CardId, player: PlayerId) -> bool {
    let owner = game.card(source).owner;
    game.move_card(source, ZoneType::Graveyard, owner);
    let _ = player;
    // TODO: Fire Discarded trigger — currently done by caller
    true
}

/// Execute typed discard (non-self).
/// Cards to discard are passed in (already selected by agent).
/// Mirrors Java's `CostDiscard.doPayment()`.
pub fn pay_as_decided_cards(game: &mut GameState, cards: &[CardId], _player: PlayerId) -> bool {
    for &cid in cards {
        let owner = game.card(cid).owner;
        game.move_card(cid, ZoneType::Graveyard, owner);
        // TODO: Fire Discarded trigger per card
    }
    // TODO: Fire DiscardedAll trigger after all discards
    true
}

/// Hash keys for LKI/card tracking lists.
pub const HASH_LKI: &str = "Discarded";
pub const HASH_CARDS: &str = "DiscardedCards";

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
    let super::CostPart::Discard {
        type_filter,
        amount,
    } = part
    else {
        return false;
    };
    let card = game.card(source);
    if type_filter == "CARDNAME" {
        return card.zone == ZoneType::Hand;
    }
    if type_filter == "Hand" {
        return true;
    }
    if type_filter == "Card" || type_filter.is_empty() {
        let mut hand_size = game.cards_in_zone(ZoneType::Hand, player).len() as i32;
        if card.zone == ZoneType::Hand && card.owner == player {
            hand_size -= 1;
        }
        return hand_size >= amount.resolve(game, source, player);
    }
    let mut matching = game
        .cards_in_zone(ZoneType::Hand, player)
        .iter()
        .filter(|&&cid| {
            crate::ability::effects::matches_change_type(game.card(cid), type_filter, &[])
        })
        .count() as i32;
    if card.zone == ZoneType::Hand
        && card.owner == player
        && crate::ability::effects::matches_change_type(card, type_filter, &[])
    {
        matching -= 1;
    }
    matching >= amount.resolve(game, source, player)
}

pub fn pay_with_decision(
    game: &mut GameState,
    player: PlayerId,
    source: CardId,
    part: &super::CostPart,
    decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    let super::CostPart::Discard { type_filter, .. } = part else {
        return false;
    };
    if type_filter == "CARDNAME" || type_filter == "NICKNAME" {
        return pay_as_decided_self(game, source, player);
    }
    if let crate::cost::payment_decision::PaymentDecision::Cards(cards) = decision {
        return pay_as_decided_cards(game, cards, player);
    }
    false
}
