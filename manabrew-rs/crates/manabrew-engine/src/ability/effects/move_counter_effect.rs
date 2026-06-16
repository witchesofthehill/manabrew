use forge_foundation::ZoneType;

use super::{resolve_numeric_svar, EffectContext};
use crate::ability::ability_ir::DefinedRef;
use crate::card::CounterType;
use crate::event::RunParams;
use crate::parsing::keys;
use crate::trigger::TriggerType;

/// `SP$ MoveCounter` — move counters from one permanent to another.
///
/// Mirrors Java's `CountersMoveEffect.java`.
/// - `CounterType$` — type of counter to move (default P1P1).
/// - `CounterNum$` — number of counters to move (default 1).
/// - `Source$` — where to take counters from (default Self/source card).
/// - `Defined$` — where to put counters (default Targeted).
///
/// # Card script examples
/// ```text
/// A:SP$ MoveCounter | CounterType$ P1P1 | CounterNum$ 1 | Source$ Self | Defined$ Targeted
/// A:SP$ MoveCounter | CounterType$ CHARGE | CounterNum$ 2
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `MoveCounterEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(MoveCounterEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let counter_type = sa.ir.counter_type.clone().unwrap_or(CounterType::P1P1);
    let count = resolve_numeric_svar(ctx.game, sa, keys::COUNTER_NUM, 1);
    if count <= 0 {
        return;
    }

    // Determine source of counters
    let from_id = match sa.ir.source_text.as_deref() {
        Some(source) if matches!(DefinedRef::parse(source), DefinedRef::Targeted) => {
            sa.target_chosen.target_card
        }
        Some(source) if matches!(DefinedRef::parse(source), DefinedRef::ParentTarget) => {
            ctx.parent_target_card
        }
        _ => sa.source, // Default: Self
    };

    // Determine destination for counters
    let to_id = sa
        .target_chosen
        .target_card
        .or_else(|| match sa.defined_ref() {
            Some(DefinedRef::SelfCard) => sa.source,
            Some(DefinedRef::ParentTarget) => ctx.parent_target_card,
            _ => None,
        });

    let from = match from_id {
        Some(id) if ctx.game.card(id).zone == ZoneType::Battlefield => id,
        _ => return,
    };
    let to = match to_id {
        Some(id) if ctx.game.card(id).zone == ZoneType::Battlefield => id,
        _ => return,
    };

    if from == to {
        return;
    }

    // Calculate how many we can actually move
    let available = ctx.game.card(from).counter_count(&counter_type);
    let actual = count.min(available);
    if actual <= 0 {
        return;
    }

    // Remove from source
    ctx.game
        .card_mut(from)
        .remove_counter(&counter_type, actual);
    ctx.trigger_handler.run_trigger(
        TriggerType::CounterRemoved,
        RunParams {
            card: Some(from),
            counter_type: Some(format!("{:?}", counter_type)),
            counter_amount: Some(actual),
            ..Default::default()
        },
        false,
    );

    // Add to destination
    if crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
        &ctx.game.cards,
        ctx.game.card(to),
        &counter_type,
    ) {
        return;
    }
    let add_amount = if let Some(max) =
        crate::staticability::static_ability_max_counter::max_counter(
            &ctx.game.cards,
            ctx.game.card(to),
            &counter_type,
        ) {
        (max - ctx.game.card(to).counter_count(&counter_type)).clamp(0, actual)
    } else {
        actual
    };
    if add_amount <= 0 {
        return;
    }
    ctx.game.card_mut(to).add_counter(&counter_type, add_amount);
    ctx.trigger_handler.run_trigger(
        TriggerType::CounterAdded,
        RunParams {
            card: Some(to),
            counter_type: Some(format!("{:?}", counter_type)),
            counter_amount: Some(add_amount),
            ..Default::default()
        },
        false,
    );
}
