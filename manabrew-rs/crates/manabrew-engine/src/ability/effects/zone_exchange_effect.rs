//! ZoneExchange effect — swap a card between two zones.
//!
//! Ported from Java's `ZoneExchangeEffect.java`.
//! Exchange a card in one zone with a card in another zone.
//! Example: swap a permanent on battlefield with a card in hand.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ids::CardId;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `ZoneExchangeEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(ZoneExchangeEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let controller = sa.activating_player;

    // Determine the two zones
    let zone1 = sa.ir.zone1.unwrap_or(ZoneType::Battlefield);
    let zone2 = sa.ir.zone2.unwrap_or(ZoneType::Hand);

    // Object 1: defined card or source
    let object1 = if let Some(def) = sa.ir.object_text.as_deref() {
        if def == "Self" {
            sa.source
        } else {
            sa.source
                .and_then(|sid| ctx.game.card(sid).remembered_cards.first().copied())
        }
    } else {
        sa.source
    };

    let obj1 = match object1 {
        Some(id) => id,
        None => return,
    };

    // Verify object1 is in zone1
    if ctx.game.card(obj1).zone != zone1 {
        return;
    }
    if ctx.game.card(obj1).owner != controller {
        return;
    }

    // Get candidates for object2 from zone2
    let candidates: Vec<CardId> = ctx
        .game
        .cards
        .iter()
        .filter(|c| c.zone == zone2 && c.owner == controller)
        .map(|c| c.id)
        .collect();

    if candidates.is_empty() {
        return;
    }

    // Agent chooses object2
    ctx.agents[controller.index()].snapshot_state(ctx.game, ctx.mana_pools);
    let obj2 = ctx.agents[controller.index()]
        .choose_single_card_for_zone_change(
            ctx.game,
            controller,
            &candidates,
            "Choose a card to exchange",
            false,
        )
        .unwrap_or(candidates[0]);

    // Verify object2 is still in zone2
    if ctx.game.card(obj2).zone != zone2 {
        return;
    }

    // Perform the exchange: move obj1 to zone2, obj2 to zone1
    let old1 = ctx.game.card(obj1).zone;
    let old2 = ctx.game.card(obj2).zone;

    ctx.move_card(obj1, zone2, controller);
    ctx.move_card(obj2, zone1, controller);

    super::emit_zone_trigger(ctx.trigger_handler, obj1, old1, zone2);
    super::emit_zone_trigger(ctx.trigger_handler, obj2, old2, zone1);
}
