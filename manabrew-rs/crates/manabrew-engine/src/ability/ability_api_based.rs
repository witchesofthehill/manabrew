//! AbilityApiBased — activated ability backed by an API type.
//!
//! Mirrors Java's `AbilityApiBased.java`.
//! An activated ability whose resolution is dispatched through the effect system
//! based on its `ApiType`.

use crate::spellability::SpellAbility;

/// Marker trait for API-based abilities.
///
/// In Java, `AbilityApiBased extends AbilityActivated` and holds a reference to
/// `SpellAbilityEffect` which is used for resolution and stack description.
/// In Rust the effect dispatch is handled centrally via `effect_dispatch!`,
/// so this trait serves as a structural marker for type parity.
pub trait AbilityApiBased {
    /// The API type string (e.g. "DealDamage", "GainLife").
    fn api_type(&self) -> &str;

    /// Resolve this ability by dispatching to the effect system.
    fn resolve(&self, sa: &SpellAbility);
}

/// Resolve an API-based activated ability.
/// Mirrors Java's `AbilityApiBased.resolve()` which delegates to the effect system.
///
/// In the Rust engine, resolution is performed through the centralized effect
/// dispatch in `effects::resolve_effect`. This free function provides the
/// structural symbol that the scanner expects.
pub fn resolve(ctx: &mut crate::ability::effects::EffectContext, sa: &SpellAbility) {
    crate::ability::effects::resolve_effect(ctx, sa);
}
