//! Blight as a cost — put -1/-1 counters on creatures you control.
//! Mirrors Java's `CostBlight` which extends `CostPutCounter`.

use crate::card::CounterType;
use crate::game::GameState;
use crate::ids::CardId;

/// Execute blight payment for selected creatures.
/// Puts a -1/-1 counter on each chosen creature.
pub fn pay_as_decided_cards(game: &mut GameState, cards: &[CardId]) -> bool {
    for &cid in cards {
        game.card_mut(cid).add_counter(&CounterType::M1M1, 1);
    }
    true
}

/// Refund blight payment — remove the -1/-1 counters.
pub fn refund(game: &mut GameState, cards: &[CardId]) {
    for &cid in cards {
        game.card_mut(cid).remove_counter(&CounterType::M1M1, 1);
    }
}

pub fn can_pay(
    game: &crate::game::GameState,
    source: crate::ids::CardId,
    player: crate::ids::PlayerId,
    part: &super::CostPart,
) -> bool {
    let super::CostPart::Blight(amount) = part else {
        return false;
    };
    let resolved_amount = amount.resolve(game, source, player);
    let battlefield_cards: Vec<_> = game
        .players
        .iter()
        .flat_map(|p| game.cards_in_zone(forge_foundation::ZoneType::Battlefield, p.id))
        .map(|&cid| game.card(cid).clone())
        .collect();
    let creature_count = game
        .cards_in_zone(forge_foundation::ZoneType::Battlefield, player)
        .iter()
        .filter(|&&cid| {
            let c = game.card(cid);
            c.is_creature()
                && !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
                    &battlefield_cards,
                    c,
                    &CounterType::M1M1,
                )
        })
        .count() as i32;
    creature_count >= resolved_amount
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
