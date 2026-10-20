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

    let number = sa.ir.counter_num_text.as_deref().unwrap_or("1");
    let remove_all = number.eq_ignore_ascii_case("All");
    let any_number = number.eq_ignore_ascii_case("Any");
    let requested_count = if remove_all || any_number {
        i32::MAX
    } else {
        super::resolve_numeric_svar(ctx.game, sa, "CounterNum", 1)
    };

    let target_card = resolve_target_card(ctx, sa);
    let Some(card_id) = target_card else {
        return;
    };

    if counter_type_str.eq_ignore_ascii_case("Any") {
        remove_any_type(ctx, sa, card_id, requested_count, sa.ir.up_to || any_number);
        return;
    }
    let counter_types = if counter_type_str.eq_ignore_ascii_case("All") {
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
    for counter_type in counter_types {
        if !crate::replacement::replace_remove_counter::can_remove_counters(
            ctx.game,
            card_id,
            &counter_type,
        ) {
            continue;
        }
        let current = ctx.game.card(card_id).counter_count(&counter_type);
        let mut requested = if counter_type_str.eq_ignore_ascii_case("All") {
            current
        } else {
            requested_count.min(current).max(0)
        };
        if !counter_type_str.eq_ignore_ascii_case("All")
            && matches!(
                ctx.game.card(card_id).zone,
                forge_foundation::ZoneType::Battlefield | forge_foundation::ZoneType::Exile
            )
            && (sa.ir.up_to || any_number)
        {
            requested = ctx.agents[sa.activating_player.index()]
                .choose_number(
                    sa.activating_player,
                    sa.source,
                    "Select number of counters to remove",
                    None,
                    0,
                    requested,
                )
                .unwrap_or(0)
                .clamp(0, requested);
        }
        super::effect_context::remove_counter_with_context(
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
    }
}

fn remove_any_type(
    ctx: &mut EffectContext,
    sa: &SpellAbility,
    card_id: CardId,
    mut remaining: i32,
    up_to: bool,
) {
    let mut counters: Vec<_> = ctx
        .game
        .card(card_id)
        .counters
        .iter()
        .filter(|(counter_type, count)| {
            **count > 0
                && crate::replacement::replace_remove_counter::can_remove_counters(
                    ctx.game,
                    card_id,
                    counter_type,
                )
        })
        .map(|(counter_type, count)| (counter_type.clone(), *count))
        .collect();
    counters.sort_by(|a, b| a.0.cmp(&b.0));
    while remaining > 0 && !counters.is_empty() {
        let types: Vec<_> = counters.iter().map(|(ct, _)| ct.clone()).collect();
        let Some(counter_type) = ctx.agents[sa.activating_player.index()].choose_counter_type(
            sa.activating_player,
            &types,
            "Select counter type",
        ) else {
            break;
        };
        let Some(index) = counters.iter().position(|(ct, _)| *ct == counter_type) else {
            break;
        };
        let (_, count) = counters.remove(index);
        let max = remaining.min(count);
        let available: i32 = counters.iter().map(|(_, count)| count).sum();
        let min = if up_to { 0 } else { (max - available).max(1) };
        let chosen = ctx.agents[sa.activating_player.index()]
            .choose_number(
                sa.activating_player,
                sa.source,
                "Select number of counters to remove",
                None,
                min,
                max,
            )
            .unwrap_or(min)
            .clamp(min, max);
        if chosen == 0 && up_to {
            break;
        }
        super::effect_context::remove_counter_with_context(
            ctx.game,
            ctx.trigger_handler,
            card_id,
            &counter_type,
            chosen,
            RunParams {
                player: Some(sa.activating_player),
                ..Default::default()
            },
        );
        remaining -= chosen;
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
