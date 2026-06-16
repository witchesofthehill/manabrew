//! LifeExchangeVariant effect — variant life total exchange.
//!
//! Ported from Java's `LifeExchangeVariantEffect.java`.
//! Exchange life totals with specific modifications.

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `LifeExchangeVariantEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(LifeExchangeVariantEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    let target = sa
        .target_chosen
        .target_player
        .unwrap_or_else(|| ctx.game.opponent_of(controller));

    ctx.game.player_exchange_life_totals(controller, target);
}
