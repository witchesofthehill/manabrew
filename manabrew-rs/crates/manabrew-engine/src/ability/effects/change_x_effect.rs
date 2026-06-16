//! ChangeX effect — modify the X value of a spell or ability.
//!
//! Ported from Java's `ChangeXEffect.java`.

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChangeXEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ChangeXEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(source_id) = sa.source else { return };

    let new_x = super::resolve_numeric_svar(ctx.game, sa, "NewX", 0);
    ctx.game
        .card_mut(source_id)
        .svars
        .insert("X".to_string(), format!("Number${}", new_x));
}
