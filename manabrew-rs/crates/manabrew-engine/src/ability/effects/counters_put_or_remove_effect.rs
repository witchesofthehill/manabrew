use forge_foundation::ZoneType;

use super::{resolve_numeric_svar, EffectContext};
use crate::agent::BinaryChoiceKind;
use crate::parsing::keys;

/// `SP$ CountersPutOrRemove` — choose add/remove on target card counters.
///
/// Mirrors Java `CountersPutOrRemoveEffect.java` binary choice semantics.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CountersPutOrRemoveEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(CountersPutOrRemoveEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(source_id) = sa.source else { return };
    let controller = sa.activating_player;
    let source_name = ctx.game.card(source_id).card_name.clone();

    let amount = resolve_numeric_svar(ctx.game, sa, keys::COUNTER_NUM, 1);
    if amount <= 0 {
        return;
    }

    let target_id = sa.target_chosen.target_card.or(sa.source);
    let Some(target_id) = target_id else { return };
    if ctx.game.card(target_id).zone != ZoneType::Battlefield {
        return;
    }

    let counter_type = sa.ir.counter_type.clone().or_else(|| {
        // Sort keys for deterministic fallback (HashMap iteration is random).
        let mut keys: Vec<_> = ctx.game.card(target_id).counters.keys().cloned().collect();
        keys.sort_by(|a, b| format!("{:?}", a).cmp(&format!("{:?}", b)));
        keys.into_iter().next()
    });
    let Some(counter_type) = counter_type else {
        return;
    };

    let can_add =
        !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
            &ctx.game.cards,
            ctx.game.card(target_id),
            &counter_type,
        );
    let can_remove = ctx.game.card(target_id).counter_count(&counter_type) > 0;
    if !can_add && !can_remove {
        return;
    }

    let put_counter = if can_add && can_remove {
        let prompt = format!(
            "Add or remove {:?} counter on {}?",
            counter_type,
            ctx.game.card(target_id).card_name
        );
        ctx.agents[controller.index()].choose_binary(
            controller,
            &prompt,
            BinaryChoiceKind::AddOrRemove,
            None,
            Some(source_id),
            sa.api,
        )
    } else {
        can_add
    };

    if put_counter {
        ctx.game
            .card_mut(target_id)
            .add_counter(&counter_type, amount);
        ctx.trigger_handler.run_trigger(
            crate::trigger::TriggerType::CounterAdded,
            crate::event::RunParams {
                card: Some(target_id),
                counter_type: Some(format!("{:?}", counter_type)),
                counter_amount: Some(amount),
                cause_player: Some(controller),
                ..Default::default()
            },
            false,
        );
    } else {
        ctx.game
            .card_mut(target_id)
            .remove_counter(&counter_type, amount);
        ctx.trigger_handler.run_trigger(
            crate::trigger::TriggerType::CounterRemoved,
            crate::event::RunParams {
                card: Some(target_id),
                counter_type: Some(format!("{:?}", counter_type)),
                counter_amount: Some(amount),
                cause_player: Some(controller),
                ..Default::default()
            },
            false,
        );
        if sa.ir.remember_removed_cards {
            ctx.game.card_mut(source_id).add_remembered_card(target_id);
        }
    }
}
