//! CountersMultiply effect — double (or multiply) counters on a permanent.
//!
//! Ported from Java's `CountersMultiplyEffect.java`.
//! Double the number of each type of counter on target permanent.

use super::EffectContext;
use forge_foundation::ZoneType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CountersMultiplyEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(CountersMultiplyEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let multiplier = super::resolve_numeric_svar(ctx.game, sa, "Multiplier", 2).max(0);
    let counter_type_filter = sa.ir.counter_type.clone();

    let targets: Vec<crate::ids::CardId> = if sa.uses_targeting() {
        sa.target_chosen.target_card.into_iter().collect()
    } else {
        sa.source.into_iter().collect()
    };

    for card_id in targets {
        if ctx.game.card(card_id).zone != ZoneType::Battlefield {
            continue;
        }

        if let Some(ref ct) = counter_type_filter {
            // Multiply specific counter type
            let current = *ctx.game.card(card_id).counters.get(ct).unwrap_or(&0);
            let to_add = current * (multiplier - 1);
            if to_add > 0 {
                ctx.game.card_mut(card_id).add_counter(ct, to_add);
            }
        } else {
            // Multiply ALL counter types
            let counters: Vec<(crate::card::CounterType, i32)> = ctx
                .game
                .card(card_id)
                .counters
                .iter()
                .map(|(k, &v)| (k.clone(), v))
                .collect();
            for (ct, current) in counters {
                let to_add = current * (multiplier - 1);
                if to_add > 0 {
                    ctx.game.card_mut(card_id).add_counter(&ct, to_add);
                }
            }
        }
    }
}
