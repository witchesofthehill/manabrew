use super::EffectContext;

/// Mirrors Java's `CleanupEffect.java`.
///
/// `DB$ Cleanup | ClearRemembered$ True`
///
/// Clears remembered cards and CMC values from the source card.
/// Used at the end of transform trigger chains (e.g. Delver of Secrets).
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CleanupEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(CleanupEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    if sa.ir.clear_remembered {
        if let Some(source_id) = sa.source {
            ctx.game.card_mut(source_id).clear_remembered();
        }
    }
}
