//! ClaimThePrize — Unfinity prize mechanic.
//! Ported from Java's ClaimThePrizeEffect: fires ClaimPrize trigger for
//! each defined attraction.

use super::EffectContext;
use crate::ability::ability_ir::DefinedRef;
use crate::event::RunParams;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ClaimThePrizeEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ClaimThePrizeEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let source = match sa.source {
        Some(s) => s,
        None => return,
    };

    // Get defined cards (attractions) — defaults to Self
    let attractions = if let Some(def) = sa.defined_ref() {
        if matches!(def, DefinedRef::SelfCard) {
            vec![source]
        } else {
            ctx.game.card(source).remembered_cards.clone()
        }
    } else {
        vec![source]
    };

    for card_id in attractions {
        ctx.trigger_handler.run_trigger(
            TriggerType::ClaimPrize,
            RunParams {
                card: Some(card_id),
                player: Some(sa.activating_player),
                ..Default::default()
            },
            false,
        );
    }
}
