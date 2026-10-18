use super::{parse_counter_type, EffectContext};
use crate::event::RunParams;
use crate::ids::CardId;
use crate::spellability::SpellAbility;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CountersRemoveEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(CountersRemoveEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let counter_type_str = sa.ir.counter_type_text.as_deref().unwrap_or("P1P1");

    // Parse amount: integer or "All" (resolve per-card).
    let remove_all = sa
        .ir
        .counter_num_text
        .as_deref()
        .is_some_and(|s| s.eq_ignore_ascii_case("All"));
    let requested_count = if remove_all {
        i32::MAX // will be clamped per-card
    } else {
        super::resolve_numeric_svar(ctx.game, sa, "CounterNum", 1)
    };

    let target_card = resolve_target_card(ctx, sa);
    let Some(card_id) = target_card else {
        return;
    };

    let counter_types = if counter_type_str.eq_ignore_ascii_case("All")
        || counter_type_str.eq_ignore_ascii_case("Any")
    {
        let mut types: Vec<_> = ctx
            .game
            .card(card_id)
            .counters
            .iter()
            .filter(|(_, count)| **count > 0)
            .map(|(counter_type, _)| counter_type.clone())
            .collect();
        types.sort();
        types
    } else {
        vec![parse_counter_type(counter_type_str)]
    };
    let mut remaining = requested_count;
    let mut types = counter_types;
    while !types.is_empty() {
        let counter_type = if counter_type_str.eq_ignore_ascii_case("Any") {
            ctx.agents[sa.activating_player.index()].choose_counter_type(
                sa.activating_player,
                &types,
                "Select counter type",
            )
        } else {
            types.first().cloned()
        };
        let Some(counter_type) = counter_type else {
            break;
        };
        types.retain(|candidate| *candidate != counter_type);
        let current = ctx.game.card(card_id).counter_count(&counter_type);
        let requested = if counter_type_str.eq_ignore_ascii_case("All") {
            current
        } else {
            remaining
        };
        let actual = super::effect_context::remove_counter_with_context(
            ctx.game,
            ctx.trigger_handler,
            card_id,
            &counter_type,
            requested,
            RunParams {
                player: Some(sa.activating_player),
                ..Default::default()
            },
        );
        if counter_type_str.eq_ignore_ascii_case("Any") {
            remaining -= actual;
            if remaining <= 0 {
                break;
            }
        }
    }
}

/// Resolve the target card for counter removal.
/// Checks `Defined$ Self`, `Defined$ Targeted` / `Defined$ ParentTarget`,
/// and targeting (target_chosen.target_card).
fn resolve_target_card(ctx: &EffectContext, sa: &SpellAbility) -> Option<CardId> {
    // Explicit targeting takes priority.
    if let Some(card_id) = sa.target_chosen.target_card {
        return Some(card_id);
    }

    let defined = sa.defined().unwrap_or("Self");

    match defined {
        "Self" => sa.source,
        "ParentTarget" => ctx.parent_target_card,
        "Targeted" => sa.target_chosen.target_card,
        _ => sa.source, // fallback to source
    }
}
