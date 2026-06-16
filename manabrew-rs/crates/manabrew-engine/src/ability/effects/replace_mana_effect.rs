//! ReplaceMana effect — replace mana production with different mana.
//!
//! Ported from Java's `ReplaceManaEffect.java`.

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ReplaceManaEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ReplaceManaEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // Mana replacement is handled by the mana system's replacement handler.
    if let Some(source_id) = sa.source {
        if let Some(val) = sa.ir.mana_replacement.as_deref() {
            ctx.game
                .card_mut(source_id)
                .set_s_var("ManaReplacement", val);
        }
    }
}
