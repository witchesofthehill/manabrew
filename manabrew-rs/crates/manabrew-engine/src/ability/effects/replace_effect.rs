//! Replace effect — generic replacement effect registration.
//!
//! Ported from Java's `ReplaceEffect.java`.
//! Registers or modifies a replacement effect on the game state.

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ReplaceEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ReplaceEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // Generic replacement effects are handled by the replacement handler system.
    // This effect type is primarily a marker — the actual replacement logic
    // is defined by the ReplacementEffect on the source card and processed
    // by the replacement_handler module.

    // Some Replace effects store values for their replacement:
    if let Some(source_id) = sa.source {
        if let Some(val) = sa.ir.replace_with_text.as_deref() {
            ctx.game
                .card_mut(source_id)
                .svars
                .insert("ReplaceWith".to_string(), val.to_string());
        }
    }
}
