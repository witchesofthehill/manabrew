//! ChooseSector — choose a sector (Unfinity attraction board).
//! Ported from Java's ChooseSectorEffect: stores chosen sector on host card.

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ChooseSectorEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ChooseSectorEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    if let Some(source) = sa.source {
        // Auto-choose sector 1 (in full implementation, agent would choose)
        let sector = ctx.rng.next_int(6) + 1;
        ctx.game
            .card_mut(source)
            .set_s_var("ChosenSector", format!("Number${}", sector));
    }
}
