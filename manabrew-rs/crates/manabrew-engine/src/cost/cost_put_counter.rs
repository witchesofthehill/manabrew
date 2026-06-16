//! Put counters on permanents as a cost. Mirrors Java's `CostPutCounter`.
//!
//! Java's `CostPutCounter` extends `CostPartWithList` and manages counter
//! placement on source or target permanents. It also handles ETB replacement
//! effects where counters are placed as the card enters the battlefield.

use crate::card::CounterType;
use crate::game::GameState;
use crate::ids::CardId;

/// Add counters to the source.
/// Mirrors Java's `CostPutCounter.doPayment()`.
pub fn pay_as_decided(
    game: &mut GameState,
    source: CardId,
    amount: i32,
    counter_type: &CounterType,
) -> bool {
    game.card_mut(source).add_counter(counter_type, amount);
    // TODO: Fire counter placement triggers via GameEntityCounterTable
    // Java's CostPutCounter.triggerCounterPutAll() handles this
    true
}

/// Refund by removing the placed counters.
/// Mirrors Java's `CostPutCounter.refund()`.
pub fn refund(game: &mut GameState, source: CardId, amount: i32, counter_type: &CounterType) {
    game.card_mut(source).remove_counter(counter_type, amount);
}

pub const HASH_LKI: &str = "CounterPut";
pub const HASH_CARDS: &str = "CounterPutCards";

pub fn payment_order(part: &super::CostPart) -> i32 {
    part.payment_order()
}

pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    source: crate::ids::CardId,
    _player: crate::ids::PlayerId,
    _ability: Option<&crate::spellability::SpellAbility>,
    _part: &super::CostPart,
) -> bool {
    game.card(source).zone == forge_foundation::ZoneType::Battlefield
}

pub fn pay_with_decision(
    game: &mut GameState,
    player: crate::ids::PlayerId,
    source: CardId,
    part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    let super::CostPart::AddCounter {
        amount,
        counter_type,
    } = part
    else {
        return false;
    };
    let resolved = amount.resolve(game, source, player);
    pay_as_decided(game, source, resolved, counter_type)
}

pub fn reset_lists() {}
