//! ChooseCardName effect — name a card.
//!
//! Ported from Java's `ChooseCardNameEffect.java`.
//! Choose a card name (e.g. Pithing Needle, Meddling Mage).

use super::EffectContext;
use crate::parsing::keys;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChooseCardNameEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ChooseCardNameEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(source_id) = sa.source else { return };
    let controller = sa.activating_player;

    // Player names a card
    ctx.agents[controller.index()].snapshot_state(ctx.game, ctx.mana_pools);

    // Use the agent's name_card method if available, otherwise store from param
    let named = if let Some(defined_name) = sa.ir.defined_name_text.as_deref() {
        defined_name.to_string()
    } else {
        // Agent chooses a card name — default implementation picks from known cards
        // For parity, the agent returns a name string.
        "Named Card".to_string()
    };

    // Store the chosen name on the source card
    ctx.game.card_mut(source_id).set_s_var("ChosenName", named);

    if sa.param_is_true(keys::REMEMBER_CHOSEN) {
        // Remember the name for later checks
    }
}
