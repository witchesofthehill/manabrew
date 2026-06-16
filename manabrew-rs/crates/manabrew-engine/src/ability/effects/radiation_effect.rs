//! Radiation — give radiation counters (Fallout).

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `RadiationEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(RadiationEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let amount = super::resolve_numeric_svar(ctx.game, sa, "Num", 1).max(0);
    let target = sa
        .target_chosen
        .target_player
        .unwrap_or(sa.activating_player);
    ctx.game.player_add_radiation(target, amount);
    ctx.game
        .player_register_radiation_effect(target, ctx.trigger_handler);
}
