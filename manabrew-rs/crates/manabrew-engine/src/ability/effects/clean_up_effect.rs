//! CleanUpEffect — cleanup/reset effect.
//!
//! Mirrors Java's `CleanUpEffect.java`.
//! Clears remembered cards, chosen cards, chosen players, etc.
//! This is a synonym file — the actual implementation lives in `cleanup_effect.rs`.
//! Java names it `CleanUpEffect` while the Rust convention uses `cleanup_effect`.

use super::EffectContext;

/// Resolve by delegating to the existing `cleanup_effect` handler.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CleanUpEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(CleanUpEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    super::cleanup_effect::CleanupEffect::resolve(ctx, sa);
}
