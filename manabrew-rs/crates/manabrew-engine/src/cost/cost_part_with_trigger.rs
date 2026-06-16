//! Trigger hooks for parity with Java `CostPartWithTrigger`.

use crate::ids::CardId;
use crate::spellability::SpellAbility;

#[derive(Debug, Clone, Default)]
pub struct CostPartTriggerState {
    pub paying_trigger_source: Option<CardId>,
}

pub fn set_trigger(state: &mut CostPartTriggerState, paying_trigger_source: Option<CardId>) {
    state.paying_trigger_source = paying_trigger_source;
}

pub fn handle_before_payment(
    _state: &CostPartTriggerState,
    _ability: Option<&SpellAbility>,
    _targets: &[CardId],
) {
    // Java builds and registers an immediate delayed trigger before payment.
    // Rust trigger synthesis for paying triggers is handled by the game loop path.
}
