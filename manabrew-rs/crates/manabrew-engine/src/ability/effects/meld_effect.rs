//! Meld effect — exile two named cards, return melded as one creature.
//!
//! Ported 1:1 from Java's `MeldEffect.java`.
//! Meld: Exile two specific named permanents you control and own,
//! then return the primary card to the battlefield transformed (melded)
//! with the secondary card linked to it.

use forge_foundation::ZoneType;

use super::{emit_zone_trigger, EffectContext};
use crate::ids::CardId;
use crate::parsing::keys;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `MeldEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(MeldEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(host_card_id) = sa.source else {
        return;
    };
    let controller = sa.activating_player;

    let prim_name = sa.ir.primary_text.as_deref().unwrap_or_default();
    let sec_name = sa.ir.secondary_text.as_deref().unwrap_or_default();
    let sec_type = sa.ir.secondary_type_text.as_deref().unwrap_or("Creature");

    // Find a permanent you control and own named "Secondary" matching SecondaryType
    let candidates: Vec<CardId> = ctx
        .game
        .cards
        .iter()
        .filter(|c| {
            c.zone == ZoneType::Battlefield
                && c.controller == controller
                && c.owner == controller
                && c.card_name == sec_name
                && super::matches_change_type(c, sec_type, &[])
        })
        .map(|c| c.id)
        .collect();

    if candidates.is_empty() {
        return;
    }

    // Choose which secondary to meld with (if multiple copies)
    let secondary_id = if candidates.len() == 1 {
        candidates[0]
    } else {
        ctx.agents[controller.index()].snapshot_state(ctx.game, ctx.mana_pools);
        ctx.agents[controller.index()]
            .choose_single_card_for_zone_change(
                ctx.game,
                controller,
                &candidates,
                "Choose a card to meld",
                false,
            )
            .unwrap_or(candidates[0])
    };

    // Exile both cards
    let cards_to_exile = vec![host_card_id, secondary_id];
    let mut exiled = Vec::new();

    for &card_id in &cards_to_exile {
        // canExiledBy check
        if ctx
            .game
            .card(card_id)
            .keywords
            .contains_string_ignore_case("CantBeExiled")
        {
            continue;
        }
        let old_zone = ctx.game.card(card_id).zone;
        ctx.move_card(card_id, ZoneType::Exile, controller);
        emit_zone_trigger(ctx.trigger_handler, card_id, old_zone, ZoneType::Exile);
        exiled.push(card_id);
    }

    // Both must have been exiled
    if exiled.len() < 2 {
        return;
    }

    let primary = exiled[0];
    let secondary = exiled[1];

    // Verify names are still correct in exile
    if ctx.game.card(primary).card_name != prim_name
        || ctx.game.card(secondary).card_name != sec_name
    {
        return;
    }

    // Verify neither is a token and both are still in exile
    for &c in &[primary, secondary] {
        if ctx.game.card(c).is_token || ctx.game.card(c).zone != ZoneType::Exile {
            return;
        }
    }

    // Transform primary to meld state
    ctx.game.card_mut(primary).set_transformed(true);
    if let Some(other_name) = ctx
        .game
        .card(primary)
        .other_part
        .as_ref()
        .map(|o| o.name.clone())
    {
        ctx.game.card_mut(primary).set_card_name(other_name);
    }

    // Link secondary to primary via melded_with
    ctx.game.card_mut(primary).melded_with.push(secondary);

    // Tapped$
    if sa.is_tapped() {
        ctx.game.card_mut(primary).set_tapped(true);
    }

    // Move primary to battlefield (melded form)
    let old_zone = ctx.game.card(primary).zone;
    ctx.game
        .move_card(primary, ZoneType::Battlefield, controller);
    ctx.trigger_handler
        .register_active_trigger(ctx.game, primary);
    emit_zone_trigger(
        ctx.trigger_handler,
        primary,
        old_zone,
        ZoneType::Battlefield,
    );

    let _ = super::add_to_combat(ctx, sa, primary, keys::ATTACKING);
}
