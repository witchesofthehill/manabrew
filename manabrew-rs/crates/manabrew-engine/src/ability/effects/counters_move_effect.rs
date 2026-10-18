//! CountersMove effect — move counters between permanents.
//!
//! Ported from Java's `CountersMoveEffect.java`.
//! Move N counters of a type from one permanent to another.

use super::{parse_counter_type, EffectContext};
use forge_foundation::ZoneType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CountersMoveEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(CountersMoveEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let counter_type_str = sa
        .ir
        .counter_type
        .as_ref()
        .map(|s| s.to_string())
        .unwrap_or_else(|| "P1P1".to_string());
    let counter_type = parse_counter_type(&counter_type_str);
    let amount = super::resolve_numeric_svar(ctx.game, sa, "CounterNum", 1).max(0);

    // Source: card to remove counters from
    let source_card = sa.source.filter(|&cid| {
        matches!(
            ctx.game.card(cid).zone,
            ZoneType::Battlefield | ZoneType::Exile
        )
    });
    // Target: card to add counters to
    let target_card = sa.target_chosen.target_card.filter(|&cid| {
        matches!(
            ctx.game.card(cid).zone,
            ZoneType::Battlefield | ZoneType::Exile
        )
    });

    let (Some(from), Some(to)) = (source_card, target_card) else {
        return;
    };
    if from == to {
        return;
    }

    // Remove counters from source
    let current = *ctx
        .game
        .card(from)
        .counters
        .get(&counter_type)
        .unwrap_or(&0);
    let to_move = amount.min(current);
    if to_move <= 0 {
        return;
    }
    if ctx.game.card(to).phased_out
        || crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
            &ctx.game.cards,
            ctx.game.card(to),
            &counter_type,
        )
    {
        return;
    }

    let to_move = super::effect_context::remove_counter_with_context(
        ctx.game,
        ctx.trigger_handler,
        from,
        &counter_type,
        to_move,
        crate::event::RunParams {
            player: Some(sa.activating_player),
            ..Default::default()
        },
    );
    ctx.add_counter(
        to,
        &counter_type,
        to_move,
        sa,
        crate::event::RunParams::default(),
    );
}
