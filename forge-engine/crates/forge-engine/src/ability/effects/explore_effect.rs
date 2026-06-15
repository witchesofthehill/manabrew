use forge_foundation::ZoneType;

use super::{emit_zone_trigger, EffectContext};
use crate::ability::ability_ir::DefinedRef;
use crate::card::CounterType;
use crate::event::RunParams;
use crate::parsing::keys;
use crate::replacement::replacement_handler::{apply_replacements, ReplacementEvent};
use crate::replacement::ReplacementResult;
use crate::trigger::TriggerType;

/// `SP$ Explore` — target creature explores.
///
/// Mirrors Java's `ExploreEffect.java`.
/// Explore: Reveal the top card of your library. If it's a land, put it into your hand.
/// Otherwise, put a +1/+1 counter on this creature, then you may put the card into
/// your graveyard.
///
/// # Card script examples
/// ```text
/// A:SP$ Explore | Defined$ Self
/// A:SP$ Explore | Defined$ Targeted | Num$ 2
/// ```
/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ExploreEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(ExploreEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    // Determine the exploring creature
    let explorer = sa
        .target_chosen
        .target_card
        .or_else(|| match sa.defined_ref() {
            Some(DefinedRef::SelfCard) => sa.source,
            Some(DefinedRef::ParentTarget) => ctx.parent_target_card,
            _ => sa.source,
        });

    let explorer_id = match explorer {
        Some(id) if ctx.game.card(id).zone == ZoneType::Battlefield => id,
        _ => return,
    };

    // Run Explore replacement effects before exploring.
    let mut event = ReplacementEvent::Explore { card: explorer_id };
    let result = apply_replacements(ctx.game, &mut event);
    if result == ReplacementResult::Skipped || result == ReplacementResult::Replaced {
        return;
    }

    // Parse Num parameter for multiple explores (e.g. Jadelight Ranger explores twice).
    // Mirrors Java's `AbilityUtils.calculateAmount(host, sa.getParamOrDefault("Num", "1"), sa)`.
    let amount = super::resolve_numeric_svar(ctx.game, sa, keys::NUM, 1).max(1);

    for _ in 0..amount {
        // Re-check explorer is still on battlefield (may have been removed by a trigger)
        if ctx.game.card(explorer_id).zone != ZoneType::Battlefield {
            return;
        }
        ctx.game.player_record_explore(controller, 1);

        // Check if library has cards
        let lib = ctx.game.cards_in_zone(ZoneType::Library, controller);
        if lib.is_empty() {
            // Explorer still gets the +1/+1 counter per rules
            if !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
                &ctx.game.cards,
                ctx.game.card(explorer_id),
                &CounterType::P1P1,
            ) {
                ctx.game
                    .card_mut(explorer_id)
                    .add_counter(&CounterType::P1P1, 1);
            }
            ctx.trigger_handler.run_trigger(
                TriggerType::CounterAdded,
                RunParams {
                    card: Some(explorer_id),
                    counter_type: Some("P1P1".to_string()),
                    counter_amount: Some(1),
                    ..Default::default()
                },
                false,
            );
            continue;
        }

        // Reveal top card
        let top_card = *lib.last().unwrap();

        let is_land = ctx.game.card(top_card).is_land();

        if is_land {
            // Land → put into hand
            let owner = ctx.game.card(top_card).owner;
            ctx.move_card(top_card, ZoneType::Hand, owner);
            emit_zone_trigger(
                ctx.trigger_handler,
                top_card,
                ZoneType::Library,
                ZoneType::Hand,
            );
        } else {
            // Nonland → put +1/+1 counter on explorer
            if !crate::staticability::static_ability_cant_put_counter::any_cant_put_counter_on_card(
                &ctx.game.cards,
                ctx.game.card(explorer_id),
                &CounterType::P1P1,
            ) {
                ctx.game
                    .card_mut(explorer_id)
                    .add_counter(&CounterType::P1P1, 1);
            }
            ctx.trigger_handler.run_trigger(
                TriggerType::CounterAdded,
                RunParams {
                    card: Some(explorer_id),
                    counter_type: Some("P1P1".to_string()),
                    counter_amount: Some(1),
                    ..Default::default()
                },
                false,
            );

            // Player may put revealed card into graveyard (otherwise it stays on top).
            // Java's ExploreEffect calls controller.confirmAction() which in the
            // harness DeterministicController uses a random boolean (pickBool).
            // Use confirm_action here to match that RNG-consuming path.
            let card_name = ctx.game.card(top_card).card_name.clone();
            let explorer_name = ctx.game.card(explorer_id).card_name.clone();
            let msg = format!("Put {} into your graveyard?", card_name);
            let put_in_gy = ctx.agents[controller.index()].confirm_action(
                controller,
                None,
                &msg,
                &[],
                sa.source,
                Some(crate::ability::api_type::ApiType::Explore),
            );

            if put_in_gy {
                let owner = ctx.game.card(top_card).owner;
                ctx.move_card(top_card, ZoneType::Graveyard, owner);
                emit_zone_trigger(
                    ctx.trigger_handler,
                    top_card,
                    ZoneType::Library,
                    ZoneType::Graveyard,
                );
            }
        }
        ctx.trigger_handler.run_trigger(
            TriggerType::Explored,
            RunParams {
                card: Some(explorer_id),
                explored: Some(top_card),
                ..Default::default()
            },
            false,
        );
    }
}
