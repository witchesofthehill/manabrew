//! ReplaceSplitDamage effect — replace split damage assignment.
//!
//! Ported from Java's `ReplaceSplitDamageEffect.java`.

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ReplaceSplitDamageEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ReplaceSplitDamageEffect)]
fn resolve(_ctx: &mut EffectContext, _sa: &crate::spellability::SpellAbility) {
    // Split damage replacement is handled by the replacement handler system.
}
