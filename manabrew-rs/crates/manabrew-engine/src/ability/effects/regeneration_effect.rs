//! Regeneration — set up a regeneration shield (older mechanic).

use forge_foundation::ZoneType;

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `RegenerationEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(RegenerationEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    if let Some(target) = sa.target_chosen.target_card.or(sa.source) {
        if ctx.game.card(target).zone == ZoneType::Battlefield {
            ctx.game.card_mut(target).regeneration_shields += 1;
        }
    }
}
