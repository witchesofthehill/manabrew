//! ReplaceDamage effect — replace damage with another effect.
//!
//! Ported from Java's `ReplaceDamageEffect.java`.

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ReplaceDamageEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ReplaceDamageEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // Damage replacement is handled by the replacement handler system.
    // This effect registers or configures the replacement.
    if let Some(source_id) = sa.source {
        if let Some(val) = sa.ir.damage_amount_text.as_deref() {
            ctx.game
                .card_mut(source_id)
                .set_s_var("ReplaceDamageAmount", val);
        }
    }
}
