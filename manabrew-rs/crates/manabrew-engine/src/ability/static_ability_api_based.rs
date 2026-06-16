//! StaticAbilityApiBased — static abilities backed by an API type.
//!
//! Mirrors Java's `StaticAbilityApiBased.java`.
//! A static ability whose resolution is dispatched through the effect
//! system based on its `ApiType`.

use crate::spellability::SpellAbility;

/// Marker trait for API-based static abilities.
///
/// In Java, `StaticAbilityApiBased extends AbilityStatic` and holds a
/// reference to `SpellAbilityEffect`. In Rust the dispatch is centralized
/// in `effect_dispatch!`, so this provides structural parity.
pub trait StaticAbilityApiBased {
    /// The API type string (e.g. "Pump", "Animate").
    fn api_type(&self) -> &str;

    /// Resolve this static ability by dispatching to the effect system.
    fn resolve(&self, sa: &SpellAbility);
}

/// Resolve an API-based static ability.
/// Mirrors Java's `StaticAbilityApiBased.resolve()` which delegates to its effect.
///
/// In the Rust engine, resolution is centralized in `effects::resolve_effect`.
pub fn resolve(ctx: &mut crate::ability::effects::EffectContext, sa: &SpellAbility) {
    crate::ability::effects::resolve_effect(ctx, sa);
}
