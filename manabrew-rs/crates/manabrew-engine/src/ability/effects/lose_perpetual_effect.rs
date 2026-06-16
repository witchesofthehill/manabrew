//! LosePerpetual — remove perpetual effects (digital-only, Alchemy).
//! Ported from Java's LosePerpetualEffect: removes a perpetual trait change
//! identified by the triggering trigger's timestamp.

use super::EffectContext;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `LosePerpetualEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(LosePerpetualEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(host_id) = sa.source else {
        return;
    };

    // Java parity: this effect currently removes perpetual changes that were
    // associated with the trigger currently resolving.
    if let Some(trigger_index) = sa.trigger_index {
        let trigger_id = match ctx.game.card(host_id).triggers.get(trigger_index) {
            Some(t) => t.id,
            None => return,
        };

        let to_remove: Vec<(i64, i64)> = ctx
            .game
            .card(host_id)
            .changed_card_traits
            .iter()
            .filter_map(|(key, layer)| {
                if layer.triggers.iter().any(|t| t.id == trigger_id) {
                    Some(*key)
                } else {
                    None
                }
            })
            .collect();

        for (timestamp, static_id) in to_remove {
            ctx.game
                .card_mut(host_id)
                .remove_changed_card_traits(timestamp, static_id);
            ctx.game.card_mut(host_id).remove_perpetual(timestamp);
        }
    }
}
