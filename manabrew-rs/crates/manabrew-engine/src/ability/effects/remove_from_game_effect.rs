//! RemoveFromGame — exile (old terminology).

use forge_foundation::ZoneType;

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `RemoveFromGameEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(RemoveFromGameEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    if let Some(target) = sa.target_chosen.target_card.or(sa.source) {
        let old = ctx.game.card(target).zone;
        let owner = ctx.game.card(target).owner;
        ctx.move_card(target, ZoneType::Exile, owner);
        super::emit_zone_trigger(ctx.trigger_handler, target, old, ZoneType::Exile);
    }
}
