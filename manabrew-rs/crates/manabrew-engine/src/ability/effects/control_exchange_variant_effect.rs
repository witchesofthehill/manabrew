//! ControlExchangeVariant effect — variant of control exchange.
//!
//! Mirrors Java's `ControlExchangeVariantEffect.java`.
//! Exchanges cards controlled between two players, where the activating
//! player chooses which cards to exchange.

use super::EffectContext;

/// Resolve exchange of controlled cards between two target players.
/// Currently delegates to the standard control exchange logic.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ControlExchangeVariantEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ControlExchangeVariantEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // In Java this allows choosing specific cards from each player to swap.
    // Delegates to the existing control exchange/gain variant handler for now.
    super::control_gain_variant_effect::ControlGainVariantEffect::resolve(ctx, sa);
}
