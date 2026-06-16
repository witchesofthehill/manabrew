use forge_foundation::ZoneType;

use super::{parse_counter_type, EffectContext};
use crate::event::RunParams;
use crate::ids::CardId;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::spellability::SpellAbility;
use crate::trigger::TriggerType;

/// Resolve `DB$ RemoveCounter` / `AB$ RemoveCounter` / `SP$ RemoveCounter`.
///
/// Mirrors Java `CountersRemoveEffect.java` (~280 lines). This is an MVP
/// covering the most common modes (~80% of real card usage):
///
/// - `Defined$ Self` or targeted card
/// - Specific `CounterType$` (not "Any" / "All" type modes)
/// - `CounterNum$` as integer or `"All"`
/// - Fires `TriggerType::CounterRemoved`
///
/// Deferred (would need UI interaction loops):
/// - `CounterType$ Any` / `CounterType$ All` (interactive counter type selection)
/// - `Choices$` / `ChoiceZone$` (card selection)
/// - `Optional$` (confirmation dialog)
/// - `UpTo$` (number selection)
/// - `CounterNumShared$` (shared budget across targets)
/// - Player counter removal
///
/// Real card patterns (MVP):
/// - `DB$ RemoveCounter | Defined$ Self | CounterType$ P1P1 | CounterNum$ 1`
/// - `DB$ RemoveCounter | Defined$ Self | CounterType$ TIME | CounterNum$ 1`
/// - `DB$ RemoveCounter | Defined$ Self | CounterType$ FADE | CounterNum$ 1`
/// - `AB$ RemoveCounter | ValidTgts$ Creature | CounterType$ M1M1 | CounterNum$ 1`
/// - `SP$ RemoveCounter | ValidTgts$ Creature.YouCtrl | CounterType$ P1P1 | CounterNum$ All`
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CountersRemoveEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(CountersRemoveEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    // Parse counter type — skip unsupported "Any" / "All" type modes.
    let counter_type_str = sa.ir.counter_type_text.as_deref().unwrap_or("P1P1");
    if counter_type_str.eq_ignore_ascii_case("Any") || counter_type_str.eq_ignore_ascii_case("All")
    {
        // Interactive counter type selection — not yet supported.
        return;
    }
    let counter_type = parse_counter_type(counter_type_str);

    // Parse amount: integer or "All" (resolve per-card).
    let remove_all = sa
        .ir
        .counter_num_text
        .as_deref()
        .is_some_and(|s| s.eq_ignore_ascii_case("All"));
    let requested_count = if remove_all {
        i32::MAX // will be clamped per-card
    } else {
        sa.ir
            .counter_num_text
            .as_deref()
            .and_then(|s| s.parse::<i32>().ok())
            .unwrap_or(1)
    };

    // Resolve target card.
    let target_card = resolve_target_card(ctx, sa);
    let Some(card_id) = target_card else {
        return;
    };

    // Verify card is on the battlefield.
    if ctx.game.card(card_id).zone != ZoneType::Battlefield {
        return;
    }

    // Run RemoveCounter replacement effects before removing.
    let mut event = ReplacementEvent::RemoveCounter {
        target: card_id,
        counter_type: counter_type.clone(),
        count: requested_count,
    };
    let result = apply_replacements(ctx.game, &mut event);
    if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
        return;
    }
    let requested_count = if let ReplacementEvent::RemoveCounter { count, .. } = event {
        count
    } else {
        requested_count
    };

    // Compute actual removal count (can't remove more than present).
    let current = ctx.game.card(card_id).counter_count(&counter_type);
    let actual = requested_count.min(current);
    if actual <= 0 {
        return;
    }

    // Remove counters.
    ctx.game
        .card_mut(card_id)
        .remove_counter(&counter_type, actual);

    // Fire CounterRemoved trigger.
    ctx.trigger_handler.run_trigger(
        TriggerType::CounterRemoved,
        RunParams {
            card: Some(card_id),
            counter_type: Some(format!("{:?}", counter_type)),
            counter_amount: Some(actual),
            ..Default::default()
        },
        false,
    );
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
