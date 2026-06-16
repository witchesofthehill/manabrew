//! Intensify — increase effect power (escalating).

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `IntensifyEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(IntensifyEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    if let Some(sid) = sa.source {
        let current = ctx
            .game
            .card(sid)
            .svars
            .get("IntensifyCount")
            .and_then(|s| {
                s.strip_prefix("Number$")
                    .and_then(|n| n.parse::<i32>().ok())
            })
            .unwrap_or(0);
        ctx.game
            .card_mut(sid)
            .set_s_var("IntensifyCount", format!("Number${}", current + 1));
    }
}
