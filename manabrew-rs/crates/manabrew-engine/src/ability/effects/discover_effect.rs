//! Discover effect — exile from library until a nonland card with CMC ≤ N.
//!
//! Ported 1:1 from Java's `DiscoverEffect.java`.
//! Discover N: Exile cards from the top of your library until you exile a nonland
//! card with mana value N or less. Cast it without paying its mana cost or put it
//! into your hand. Put the rest on the bottom of your library in a random order.

use forge_foundation::ZoneType;

use super::cast_from_effect;
use super::{emit_zone_trigger, EffectContext};
use crate::ids::{CardId, PlayerId};
use crate::parsing::keys;
use crate::spellability::SpellAbility;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `DiscoverEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(DiscoverEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let num = super::resolve_numeric_svar(ctx.game, sa, "Num", 1).max(0);
    let controller = sa.activating_player;

    let players = if let Some(def) = sa.defined_player() {
        super::resolve_defined_players(def, controller, ctx.game)
    } else {
        vec![controller]
    };

    for pid in players {
        discover_for_player(ctx, sa, pid, num);
    }
}

fn discover_for_player(ctx: &mut EffectContext, sa: &SpellAbility, player: PlayerId, max_cmc: i32) {
    let mut exiled_rest: Vec<CardId> = Vec::new();
    let mut found: Option<CardId> = None;

    // Exile cards from top of library one at a time until we find
    // a nonland card with mana value ≤ N
    loop {
        let lib = ctx.game.cards_in_zone(ZoneType::Library, player).to_vec();
        let Some(&top) = lib.last() else { break };

        let card = ctx.game.card(top);
        let is_land = card
            .type_line
            .core_types
            .iter()
            .any(|ct| matches!(ct, forge_foundation::CoreType::Land));
        let cmc = card.mana_cost.cmc();

        // Exile one at a time (Java: exileSeq = true)
        let old_zone = ctx.game.card(top).zone;
        ctx.move_card(top, ZoneType::Exile, player);
        emit_zone_trigger(ctx.trigger_handler, top, old_zone, ZoneType::Exile);

        if !is_land && cmc <= max_cmc {
            found = Some(top);
            if sa.param_is_true(keys::REMEMBER_DISCOVERED) {
                if let Some(sid) = sa.source {
                    ctx.game.card_mut(sid).add_remembered_card(top);
                }
            }
            break;
        } else {
            exiled_rest.push(top);
        }
    }

    // Cast or put in hand — full pipeline via cast_from_effect
    if let Some(card_id) = found {
        let has_spells = !cast_from_effect::get_basic_spells(ctx, card_id).is_empty();

        if has_spells {
            let cast = cast_from_effect::offer_cast_or_alternative(
                ctx,
                card_id,
                player,
                "Cast without paying its mana cost",
                "Put into your hand",
            );

            if cast {
                let ok =
                    cast_from_effect::cast_card_from_effect(ctx, card_id, player, true, "Discover");
                if !ok {
                    // Failed to cast — put in hand instead
                    let old = ctx.game.card(card_id).zone;
                    ctx.move_card(card_id, ZoneType::Hand, player);
                    emit_zone_trigger(ctx.trigger_handler, card_id, old, ZoneType::Hand);
                }
            } else {
                let old = ctx.game.card(card_id).zone;
                ctx.move_card(card_id, ZoneType::Hand, player);
                emit_zone_trigger(ctx.trigger_handler, card_id, old, ZoneType::Hand);
            }
        } else {
            let old = ctx.game.card(card_id).zone;
            ctx.move_card(card_id, ZoneType::Hand, player);
            emit_zone_trigger(ctx.trigger_handler, card_id, old, ZoneType::Hand);
        }
    }

    // Put the rest on bottom of library in random order
    ctx.rng.shuffle_cards(&mut exiled_rest);
    for card_id in exiled_rest {
        let old = ctx.game.card(card_id).zone;
        ctx.move_card(card_id, ZoneType::Library, player);
        ctx.game
            .reorder_card_in_zone(ZoneType::Library, player, card_id, 0);
        emit_zone_trigger(ctx.trigger_handler, card_id, old, ZoneType::Library);
    }
}
