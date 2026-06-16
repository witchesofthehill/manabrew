//! Blight — mark a permanent with a blight counter or effect.

use forge_foundation::ZoneType;

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `BlightEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(BlightEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    if let Some(target) = sa.target_chosen.target_card {
        if ctx.game.card(target).zone == ZoneType::Battlefield {
            let ct = super::parse_counter_type("BLIGHT");
            ctx.game.card_mut(target).add_counter(&ct, 1);
        }
    }
}
