use forge_foundation::ZoneType;

use super::resolve_numeric_svar;
use super::EffectContext;
use crate::agent::BinaryChoiceKind;
use crate::card::CounterType;
use crate::ids::CardId;
use crate::parsing::keys;

/// `SP$ TimeTravel` — for chosen cards, add or remove a time counter.
///
/// Mirrors Java `TimeTravelEffect.java` binary choice semantics.
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `TimeTravelEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(TimeTravelEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;
    let Some(source_id) = sa.source else { return };
    let source_name = ctx.game.card(source_id).card_name.clone();

    let amount = resolve_numeric_svar(ctx.game, sa, keys::AMOUNT, 1);
    if amount <= 0 {
        return;
    }

    for _ in 0..amount {
        let mut valid: Vec<CardId> = Vec::new();
        for &cid in ctx.game.cards_in_zone(ZoneType::Exile, controller) {
            if ctx.game.card(cid).get_suspend_cost().is_some() {
                valid.push(cid);
            }
        }
        for &cid in ctx.game.cards_in_zone(ZoneType::Battlefield, controller) {
            if ctx.game.card(cid).counter_count(&CounterType::Time) > 0 {
                valid.push(cid);
            }
        }
        if valid.is_empty() {
            break;
        }

        let chosen = ctx.agents[controller.index()].choose_cards_for_effect(
            controller,
            &valid,
            0,
            valid.len(),
        );
        for cid in chosen {
            let prompt = format!(
                "Add or remove time counter on {}?",
                ctx.game.card(cid).card_name
            );
            let add = ctx.agents[controller.index()].choose_binary(
                controller,
                &prompt,
                BinaryChoiceKind::AddOrRemove,
                None,
                Some(source_id),
                sa.api,
            );
            if add {
                ctx.game.card_mut(cid).add_counter(&CounterType::Time, 1);
                ctx.trigger_handler.run_trigger(
                    crate::trigger::TriggerType::CounterAdded,
                    crate::event::RunParams {
                        card: Some(cid),
                        counter_type: Some("Time".to_string()),
                        counter_amount: Some(1),
                        cause_player: Some(controller),
                        ..Default::default()
                    },
                    false,
                );
            } else {
                ctx.game.card_mut(cid).remove_counter(&CounterType::Time, 1);
                ctx.trigger_handler.run_trigger(
                    crate::trigger::TriggerType::CounterRemoved,
                    crate::event::RunParams {
                        card: Some(cid),
                        counter_type: Some("Time".to_string()),
                        counter_amount: Some(1),
                        cause_player: Some(controller),
                        ..Default::default()
                    },
                    false,
                );
            }
        }
    }
}
