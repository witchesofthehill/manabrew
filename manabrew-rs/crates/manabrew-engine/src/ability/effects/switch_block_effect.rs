//! SwitchBlock effect — change blockers during combat.
//!
//! Ported from Java's `SwitchBlockEffect.java`.
//! Switch which creature is blocking an attacker.

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `SwitchBlockEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(SwitchBlockEffect)]
fn resolve(ctx: &mut EffectContext, _sa: &crate::spellability::SpellAbility) {
    // SwitchBlock is a niche combat effect that modifies blocking assignments.
    // The full implementation requires deep integration with the combat system.
    // The combat module handles block declarations — this effect would modify
    // the declared blockers list.
    let _ = ctx;
}
