use forge_foundation::ZoneType;

use super::{matches_valid_cards_for_sa, resolve_numeric_svar, EffectContext};
use crate::card::CounterType;
use crate::event::RunParams;
use crate::ids::CardId;
use crate::trigger::TriggerType;

/// `SP$ PutCounterAll` — put counters on all matching permanents.
///
/// Mirrors Java's `CountersPutAllEffect.java`.
/// - `CounterType$` — type of counter (default P1P1).
/// - `CounterNum$` — number of counters to add (default 1).
/// - `ValidCards$` — filter for which cards receive counters.
/// - `ValidZone$` — zone to search (default Battlefield).
///
/// # Card script examples
/// ```text
/// A:SP$ PutCounterAll | CounterType$ P1P1 | CounterNum$ 1 | ValidCards$ Creature.YouCtrl
/// A:SP$ PutCounterAll | CounterType$ CHARGE | CounterNum$ 2 | ValidCards$ Artifact
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `CountersPutAllEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(CountersPutAllEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let counter_type = sa.ir.counter_type.clone().unwrap_or(CounterType::P1P1);
    let count = resolve_numeric_svar(ctx.game, sa, "CounterNum", 1);
    if count == 0 {
        return;
    }

    let valid_cards = sa.ir.valid_cards_selector.as_ref();
    let zone = sa.ir.valid_zone.unwrap_or(ZoneType::Battlefield);

    let player_ids = ctx.game.player_order.clone();
    let mut targets: Vec<CardId> = Vec::new();

    for &pid in &player_ids {
        let zone_cards = ctx.game.cards_in_zone(zone, pid).to_vec();
        for cid in zone_cards {
            if matches_valid_cards_for_sa(ctx.game, sa, ctx.game.card(cid), valid_cards, "Creature")
            {
                targets.push(cid);
            }
        }
    }

    apply_counter_pass(ctx, sa, &targets, zone, &counter_type, count);

    // Java parity (CountersPutAllEffect.java line 95-116): a second counter
    // type can be applied in the same effect. `ValidCards2$` optionally
    // re-filters the target set (otherwise reuse the primary targets), and
    // `CounterNum2$` defaults to the primary count.
    if sa.ir.counter_type_2.is_some()
        || sa.ir.counter_num_2_text.is_some()
        || sa.ir.valid_cards_2_selector.is_some()
    {
        let counter_type_2 = sa.ir.counter_type_2.clone().unwrap_or(counter_type.clone());
        let count_2 = if sa.ir.counter_num_2_text.is_some() {
            resolve_numeric_svar(ctx.game, sa, "CounterNum2", count)
        } else {
            count
        };
        if count_2 != 0 {
            let zone_2 = sa.ir.valid_zone_2.unwrap_or(zone);
            let targets_2: Vec<CardId> = if sa.ir.valid_cards_2_selector.is_some() {
                let mut acc = Vec::new();
                let valid_2 = sa.ir.valid_cards_2_selector.as_ref();
                for &pid in &player_ids {
                    let zone_cards = ctx.game.cards_in_zone(zone_2, pid).to_vec();
                    for cid in zone_cards {
                        if matches_valid_cards_for_sa(
                            ctx.game,
                            sa,
                            ctx.game.card(cid),
                            valid_2,
                            "Creature",
                        ) {
                            acc.push(cid);
                        }
                    }
                }
                acc
            } else {
                targets.clone()
            };
            apply_counter_pass(ctx, sa, &targets_2, zone_2, &counter_type_2, count_2);
        }
    }
}

fn apply_counter_pass(
    ctx: &mut EffectContext,
    _sa: &crate::spellability::SpellAbility,
    targets: &[CardId],
    zone: ZoneType,
    counter_type: &CounterType,
    count: i32,
) {
    if count == 0 {
        return;
    }
    for &card_id in targets {
        if ctx.game.card(card_id).zone != zone {
            continue;
        }
        if crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
            &ctx.game.cards,
            ctx.game.card(card_id),
            counter_type,
        ) {
            continue;
        }
        let add_count = if let Some(max) =
            crate::staticability::static_ability_max_counter::max_counter(
                &ctx.game.cards,
                ctx.game.card(card_id),
                counter_type,
            ) {
            (max - ctx.game.card(card_id).counter_count(counter_type)).clamp(0, count)
        } else {
            count
        };
        if add_count <= 0 {
            continue;
        }
        let old_value = ctx.game.card(card_id).counter_count(counter_type);
        ctx.game
            .card_mut(card_id)
            .add_counter(counter_type, add_count);
        // Java fires CounterAdded once per individual counter so Saga / chapter
        // triggers see the running total (Card.addCounter line 1802).
        let ct_label = format!("{:?}", counter_type);
        for i in 0..add_count {
            ctx.trigger_handler.run_trigger(
                TriggerType::CounterAdded,
                RunParams {
                    card: Some(card_id),
                    counter_type: Some(ct_label.clone()),
                    counter_amount: Some(old_value + i + 1),
                    ..Default::default()
                },
                false,
            );
        }
    }
}
