//! Remove any counter type from permanents as a cost. Mirrors Java's `CostRemoveAnyCounter`.

use crate::card::CounterType;
use crate::game::GameState;
use crate::ids::CardId;

/// Pay by removing counters from selected permanents.
/// The caller provides the (card, counter_type, amount) decisions.
/// Mirrors Java's `CostRemoveAnyCounter.payAsDecided()` which iterates
/// `decision.counterTable`.
pub fn pay_as_decided(game: &mut GameState, removals: &[(CardId, CounterType, i32)]) -> bool {
    for &(cid, ref ct, amt) in removals {
        game.card_mut(cid).remove_counter(ct, amt);
    }
    true
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
    let super::CostPart::RemoveAnyCounter {
        amount,
        type_filter,
        counter_type,
    } = part
    else {
        return false;
    };
    let total: i32 = game
        .cards_in_zone(forge_foundation::ZoneType::Battlefield, player)
        .iter()
        .filter(|&&cid| {
            type_filter == "Permanent"
                || type_filter.is_empty()
                || crate::ability::effects::matches_change_type(game.card(cid), type_filter, &[])
        })
        .map(|&cid| {
            let c = game.card(cid);
            match counter_type {
                Some(ct) => c.counter_count(ct),
                None => c.counters.values().sum(),
            }
        })
        .sum();
    total >= amount.resolve(game, source, player)
}

pub fn pay_with_decision(
    _game: &mut GameState,
    _player: crate::ids::PlayerId,
    _source: CardId,
    _part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    true
}
