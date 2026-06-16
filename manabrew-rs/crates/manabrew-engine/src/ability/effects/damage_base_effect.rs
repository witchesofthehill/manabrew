//! DamageBaseEffect — abstract base for damage effects.
//!
//! Mirrors Java's `DamageBaseEffect.java`.
//! In Java this is an empty abstract class extending SpellAbilityEffect.
//! In Rust it serves as a shared module for damage-related utilities.

/// Shared damage helper: check if damage should be prevented.
/// Currently a placeholder for future damage prevention logic.
pub fn should_prevent_damage(_source_has_infect: bool) -> bool {
    false
}
