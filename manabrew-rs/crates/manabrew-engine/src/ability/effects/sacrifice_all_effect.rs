use forge_foundation::ZoneType;

use super::{emit_zone_trigger_with_lki_counters, matches_change_type, EffectContext};
use crate::ability::ability_ir::DefinedRef;
use crate::card::valid_filter;
use crate::event::{AbilityValue, RunParams};
use crate::ids::CardId;
use crate::trigger::TriggerType;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `SacrificeAllEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(SacrificeAllEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let valid_cards = sa.ir.valid_cards_selector.as_ref();
    let valid_cards_filter = sa.ir.valid_cards_text.as_deref().unwrap_or("Creature");

    // When Defined$ narrows the sacrifice to specific cards (e.g. Ashling's
    // `DelayTriggerRememberedLKI` targets the token created by the parent
    // trigger), sacrifice only those cards instead of every matching
    // permanent on the battlefield.
    let defined_cards: Option<Vec<CardId>> = match sa.defined_ref() {
        Some(
            DefinedRef::DelayTriggerRememberedLki
            | DefinedRef::DelayTriggerRemembered
            | DefinedRef::Remembered,
        ) => {
            let mut ids = Vec::new();
            for value in &sa.trigger_remembered {
                if let AbilityValue::Card(cid) = value {
                    ids.push(*cid);
                }
            }
            Some(ids)
        }
        _ => None,
    };

    // UnlessCost$ X | UnlessPayer$ You — offer the payer a chance to pay a
    // cost to prevent the sacrifice entirely. Java's deterministic AI pays
    // unless-costs when able (auto-tapping lands for mana).
    if let Some(unless_cost_str) = sa.ir.unless_cost.as_deref() {
        let source = sa.source.unwrap_or(CardId(0));
        let cost = crate::cost::parse_cost(unless_cost_str);
        let payers = super::helpers::resolve_defined_players(
            sa.ir.unless_payer_text.as_deref().unwrap_or("You"),
            sa.activating_player,
            ctx.game,
        );
        for payer in payers {
            if ctx.game.player(payer).has_lost {
                continue;
            }
            let can_pay = can_pay_unless_cost(ctx, sa, source, payer, &cost);
            let cost_kind = cost.to_simple_string();
            let cost_display = crate::cost::to_prompt_string(&cost);
            let prompt = if cost_display.is_empty() {
                "Pay this cost?".to_string()
            } else {
                format!("Pay {}?", cost_display)
            };
            ctx.agents[payer.index()].snapshot_state(ctx.game, ctx.mana_pools);
            let wants_to_pay = ctx.agents[payer.index()].pay_cost_to_prevent_effect(
                payer,
                if cost_kind.is_empty() {
                    "UnlessCost"
                } else {
                    cost_kind.as_str()
                },
                &prompt,
                sa.source,
                sa.api,
                can_pay,
                &[],
                &if sa.stack_description.is_empty() {
                    sa.rebuilt_description()
                } else {
                    sa.stack_description.clone()
                },
            );
            let paid = wants_to_pay
                && can_pay
                && super::try_pay_unless_cost(ctx, sa, source, payer, &cost);
            if paid {
                return; // Cost paid — sacrifice prevented
            }
        }
    }

    let player_ids = ctx.game.player_order.clone();
    let mut to_sacrifice: Vec<CardId> = Vec::new();
    if let Some(defined_ids) = defined_cards {
        for cid in defined_ids {
            if cid.index() < ctx.game.cards.len()
                && ctx.game.card(cid).zone == ZoneType::Battlefield
                && !ctx.game.card(cid).phased_out
            {
                to_sacrifice.push(cid);
            }
        }
    } else {
        for &pid in &player_ids {
            let zone_cards = ctx.game.cards_in_zone(ZoneType::Battlefield, pid).to_vec();
            for cid in zone_cards {
                let card = ctx.game.card(cid);
                if card.phased_out {
                    continue;
                }
                let matches = match (valid_cards, sa.source) {
                    (Some(selector), Some(source_id)) => {
                        valid_filter::matches_valid_card_selector_in_game(
                            selector,
                            card,
                            ctx.game.card(source_id),
                            ctx.game,
                        )
                    }
                    _ => matches_change_type(card, valid_cards_filter, &[]),
                };
                if matches {
                    to_sacrifice.push(cid);
                }
            }
        }
    }

    // Track per-controller batches to fire SacrificedOnce once per controller after
    // the whole sweep (mirrors Java GameAction.sacrifice line 2133-2138).
    let mut by_controller: std::collections::BTreeMap<crate::ids::PlayerId, Vec<CardId>> =
        std::collections::BTreeMap::new();

    for card_id in to_sacrifice {
        if ctx.game.card(card_id).zone != ZoneType::Battlefield {
            continue;
        }
        let controller = ctx.game.card(card_id).controller;
        let owner = ctx.game.card(card_id).owner;
        // Capture +1/+1 counter count before move (for Modular death triggers)
        let lki_p1p1 = *ctx
            .game
            .card(card_id)
            .counters
            .get(&crate::card::CounterType::P1P1)
            .unwrap_or(&0);
        let lki_power = ctx.game.card(card_id).power();
        let lki_toughness = ctx.game.card(card_id).toughness();
        // Capture LKI counters for death triggers
        {
            let lki_counters = ctx.game.card(card_id).counters.clone();
            ctx.game.card_mut(card_id).lki_counters = Some(lki_counters);
            ctx.game
                .card_mut(card_id)
                .set_lki_power_toughness(Some(lki_power), Some(lki_toughness));
        }
        // Clear temporary Animate triggers before firing events (CR 400.7).
        {
            let card = ctx.game.card_mut(card_id);
            card.clear_pump_triggers();
        }
        // Fire Sacrificed trigger
        ctx.trigger_handler.run_trigger(
            TriggerType::Sacrificed,
            RunParams {
                card: Some(card_id),
                player: Some(controller),
                ..Default::default()
            },
            false,
        );
        emit_zone_trigger_with_lki_counters(
            ctx.trigger_handler,
            card_id,
            ZoneType::Battlefield,
            ZoneType::Graveyard,
            lki_p1p1,
            lki_power,
            lki_toughness,
        );
        ctx.move_card(card_id, ZoneType::Graveyard, owner);
        ctx.trigger_handler.flush_waiting_triggers(ctx.game);
        by_controller.entry(controller).or_default().push(card_id);
    }

    crate::game_loop::fire_sacrificed_once_for_batch(ctx.game, ctx.trigger_handler, &by_controller);
}

fn can_pay_unless_cost(
    ctx: &EffectContext,
    sa: &crate::spellability::SpellAbility,
    source: CardId,
    payer: crate::ids::PlayerId,
    cost: &crate::cost::Cost,
) -> bool {
    if cost.has_mana_cost()
        && !crate::mana::can_pay_mana_cost_with_reserved_sacrifices(
            ctx.game,
            &ctx.mana_pools[payer.index()],
            payer,
            source,
            cost,
            &[],
            None,
        )
    {
        return false;
    }

    let non_mana_cost = cost.copy_with_no_mana();
    if non_mana_cost.parts.is_empty() {
        return true;
    }
    let available =
        crate::mana::calculate_available_mana(&ctx.mana_pools[payer.index()], ctx.game, payer);
    crate::cost::can_pay_with_ability(
        &non_mana_cost,
        ctx.game,
        &available,
        source,
        payer,
        Some(sa),
    )
}
