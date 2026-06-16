//! Untap the source permanent as a cost. Mirrors Java's `CostUntap`.

use crate::card::CounterType;
use crate::game::GameState;
use crate::ids::CardId;

/// Mirrors Java's `CostUntap.toString()`.
/// The untap symbol.
pub fn to_string() -> String {
    "{Q}".to_string()
}

/// Pay the untap cost by untapping the source.
/// Mirrors Java's `CostUntap.payAsDecided()`.
/// NOTE: Trigger firing (UntapAll) is handled by the caller.
pub fn pay_as_decided(game: &mut GameState, source: CardId) -> bool {
    game.untap(source);
    true
}

/// Refund the untap cost by tapping the source.
/// Mirrors Java's `CostUntap.refund()`.
pub fn refund(game: &mut GameState, source: CardId) {
    game.tap(source);
}

/// Mirrors Java's `CostUntap.canPay(...)` extra checks.
/// Checks: source can untap, is not ability-sick, and STUN counter
/// is either 0 or can be removed.
pub fn can_pay_extra(game: &GameState, source: CardId) -> bool {
    let card = game.card(source);
    let stun = CounterType::Named("STUN".to_string());
    // Mirrors Java: source.canUntap(null, false) && !source.isAbilitySick()
    //   && (source.getCounters(STUN) == 0 || source.canRemoveCounters(STUN))
    // isAbilitySick() = isCreature() && hasSickness() (sickness && !haste)
    card.can_untap()
        && !(card.is_creature() && card.summoning_sick && !card.has_haste())
        && (card.counter_count(&stun) == 0 || card.can_remove_counters(&stun))
}

/// Mirrors Java's `CostUntap.paymentOrder()`.
pub fn payment_order(_part: &super::CostPart) -> i32 {
    20
}

/// Mirrors Java's `CostUntap.isReusable()`.
pub fn is_reusable() -> bool {
    true
}

/// Mirrors Java's `CostUntap.isUndoable()`.
pub fn is_undoable() -> bool {
    true
}

/// Mirrors Java's `CostUntap.isRenewable()`.
pub fn is_renewable() -> bool {
    true
}

/// Parity shim: delegates to the central can_pay dispatcher.
pub fn can_pay(
    game: &crate::game::GameState,
    _available_mana: &crate::mana::ManaPool,
    source: crate::ids::CardId,
    _player: crate::ids::PlayerId,
    _ability: Option<&crate::spellability::SpellAbility>,
    _part: &super::CostPart,
) -> bool {
    can_pay_extra(game, source)
}

pub fn pay_with_decision(
    game: &mut GameState,
    _player: crate::ids::PlayerId,
    source: CardId,
    _part: &super::CostPart,
    _decision: &crate::cost::payment_decision::PaymentDecision,
) -> bool {
    pay_as_decided(game, source)
}
