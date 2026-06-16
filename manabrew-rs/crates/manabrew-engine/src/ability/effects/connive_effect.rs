use forge_foundation::ZoneType;

use super::{emit_zone_trigger, resolve_numeric_svar, EffectContext};
use crate::event::RunParams;
use crate::parsing::keys;
use crate::trigger::TriggerType;

/// `DB$ Connive` — target creature connives N times.
///
/// Connive: draw N cards, then discard N cards. For each nonland card
/// discarded this way, put a +1/+1 counter on the conniving creature.
///
/// Mirrors Java's `ConniveEffect.resolve()`.
///
/// # Params
/// - `ConniveNum` — number of times to connive (default: 1)
/// - Target or `Defined$` — the creature that connives
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ConniveEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ConniveEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let num = resolve_numeric_svar(ctx.game, sa, keys::CONNIVE_NUM, 1).max(0) as usize;

    // Resolve the conniving creature: source card by default.
    let conniver_id = if let Some(target) = sa.target_chosen.target_card {
        target
    } else {
        match sa.source {
            Some(id) => id,
            None => return,
        }
    };

    // The conniver must be on the battlefield.
    if ctx.game.card(conniver_id).zone != ZoneType::Battlefield {
        return;
    }

    let controller = ctx.game.card(conniver_id).controller;

    // Draw N cards.
    for _ in 0..num {
        ctx.game.draw_card(controller);
    }

    // Discard N cards from hand.
    let hand: Vec<_> = ctx.game.cards_in_zone(ZoneType::Hand, controller).to_vec();

    if hand.is_empty() {
        return;
    }

    let amt = hand.len().min(num);
    let to_discard = ctx.agents[controller.index()].choose_discard(controller, &hand, amt);

    // Count nonland cards discarded (for +1/+1 counters).
    let mut nonland_count = 0i32;
    for card_id in &to_discard {
        if ctx.game.card(*card_id).zone == ZoneType::Hand {
            if !ctx.game.card(*card_id).is_land() {
                nonland_count += 1;
            }
            ctx.game.player_record_discard(controller, 1);
            ctx.game.card_mut(*card_id).set_discarded(true);
            let owner = ctx.game.card(*card_id).owner;
            ctx.move_card(*card_id, ZoneType::Graveyard, owner);
            emit_zone_trigger(
                ctx.trigger_handler,
                *card_id,
                ZoneType::Hand,
                ZoneType::Graveyard,
            );
            ctx.trigger_handler.run_trigger(
                TriggerType::Discarded,
                RunParams {
                    card: Some(*card_id),
                    player: Some(controller),
                    ..Default::default()
                },
                false,
            );
        }
    }

    // Put +1/+1 counters on the conniver for each nonland card discarded,
    // but only if it's still on the battlefield.
    if nonland_count > 0 && ctx.game.card(conniver_id).zone == ZoneType::Battlefield {
        let counters = ctx
            .game
            .card_mut(conniver_id)
            .counters
            .entry(crate::card::CounterType::P1P1)
            .or_insert(0);
        *counters += nonland_count;

        ctx.trigger_handler.run_trigger(
            TriggerType::CounterAdded,
            RunParams {
                card: Some(conniver_id),
                counter_type: Some("P1P1".to_string()),
                counter_amount: Some(nonland_count),
                player: Some(controller),
                ..Default::default()
            },
            false,
        );
    }
}
