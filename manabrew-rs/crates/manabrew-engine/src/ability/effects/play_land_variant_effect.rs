//! PlayLandVariant effect — variant play land.
//!
//! Mirrors Java's `PlayLandVariantEffect.java`.
//! Allows a card to be played as a copy of a basic land matching
//! one of its colors.

use super::EffectContext;

/// Resolve play land variant.
/// In Java this clones a random basic land matching the source's colors
/// and plays it. Currently a stub for structural parity.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `PlayLandVariantEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(PlayLandVariantEffect)]
fn resolve(_ctx: &mut EffectContext, _sa: &crate::spellability::SpellAbility) {
    // PlayLandVariant is a niche effect used by cards like Dryad of the Ilysian Grove.
    // Full implementation requires the card database for land lookup.
    let err = crate::ability::IllegalAbilityException::new(
        "PlayLandVariant effect not yet fully implemented",
    );
    eprintln!("{}", err);
}
