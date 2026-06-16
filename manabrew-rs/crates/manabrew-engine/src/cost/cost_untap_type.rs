//! Untap other permanents of a type as a cost. Mirrors Java's `CostUntapType`.

use crate::card::CounterType;
use crate::game::GameState;
use crate::ids::CardId;

/// Mirrors Java's `CostUntapType.toString()`.
/// Produces e.g. "Untap an tapped creature you control" or "Untap 2 tapped artifacts".
pub fn to_string(part: &super::CostPart) -> String {
    match part {
        super::CostPart::UntapType {
            amount,
            type_filter,
            ..
        } => {
            let mut sb = String::from("Untap ");

            // Mirrors Java: Cost.convertAmountTypeToWords(i, getAmount(), " tapped " + desc)
            // Simplified inline since the full utility isn't ported yet.
            let desc = type_filter.as_str();
            if matches!(amount.as_literal(), Some(1)) {
                sb.push_str(&format!("a tapped {}", desc));
            } else {
                sb.push_str(&format!("{} tapped {}s", amount, desc));
            }

            if type_filter.contains("OppCtrl") {
                sb.push_str(" an opponent controls");
            } else if type_filter.contains("YouCtrl") {
                sb.push_str(" you control");
            }

            sb
        }
        _ => String::new(),
    }
}

/// Mirrors Java's `CostUntapType.canPayListAtOnce()` -- always returns true.
pub fn can_pay_list_at_once() -> bool {
    true
}

/// Pay by untapping the selected cards.
/// Mirrors Java's `CostUntapType.doListPayment(...)`.
/// The UntapAll trigger must be fired by the caller after this returns.
pub fn pay_as_decided_cards(game: &mut GameState, cards: &[CardId]) -> bool {
    for &cid in cards {
        game.untap(cid);
    }
    true
}

/// Refund by re-tapping the cards.
/// Mirrors Java's `CostUntapType.refund()`.
pub fn refund(game: &mut GameState, cards: &[CardId]) {
    for &cid in cards {
        game.tap(cid);
    }
}

/// Extra canPay check: filter candidates for STUN counter removal ability.
/// Mirrors Java's `CostUntapType.canPay()` filter:
/// `c.canUntap(null, false) && (c.getCounters(STUN) == 0 || c.canRemoveCounters(STUN))`
pub fn can_untap_candidate(game: &GameState, card_id: CardId) -> bool {
    let card = game.card(card_id);
    let stun = CounterType::Named("STUN".to_string());
    card.can_untap() && (card.counter_count(&stun) == 0 || card.can_remove_counters(&stun))
}

/// Mirrors Java's `CostUntapType.paymentOrder()`.
pub fn payment_order(_part: &super::CostPart) -> i32 {
    18
}

/// Mirrors Java's `CostUntapType.isReusable()`.
pub fn is_reusable() -> bool {
    true
}

/// Mirrors Java's `CostUntapType.isRenewable()`.
pub fn is_renewable() -> bool {
    true
}

pub const HASH_LKI: &str = "Untapped";
pub const HASH_CARDS: &str = "UntappedCards";

/// Parity shim: delegates to the central can_pay dispatcher.
pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    _ability: Option<&crate::spellability::SpellAbility>,
    part: &super::CostPart,
) -> bool {
    let super::CostPart::UntapType {
        amount,
        type_filter,
        can_untap_source,
    } = part
    else {
        return false;
    };
    let count = game
        .players
        .iter()
        .flat_map(|p| {
            game.cards_in_zone(forge_foundation::ZoneType::Battlefield, p.id)
                .to_vec()
        })
        .filter(|&cid| {
            if !can_untap_source && cid == source {
                return false;
            }
            let c = game.card(cid);
            if type_filter != "Card"
                && !type_filter.is_empty()
                && !crate::ability::effects::matches_change_type(c, type_filter, &[])
            {
                return false;
            }
            can_untap_candidate(game, cid)
        })
        .count() as i32;
    count >= amount.resolve(game, source, player)
}

pub fn pay_with_decision(
    game: &mut GameState,
    _player: crate::ids::PlayerId,
    _source: CardId,
    _part: &super::CostPart,
    decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    if let crate::cost::payment_decision::PaymentDecision::Cards(cards) = decision {
        return pay_as_decided_cards(game, cards);
    }
    false
}
