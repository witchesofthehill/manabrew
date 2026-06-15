//! Haunt effect — exile card haunting a creature.
//!
//! Ported 1:1 from Java's `HauntEffect.java`.
//! When a creature with Haunt dies (or spell resolves), exile it haunting
//! target creature. When the haunted creature dies, the haunt triggers.

use forge_foundation::ZoneType;

use super::{emit_zone_trigger, EffectContext};
use crate::ids::CardId;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `HauntEffect` class extending `SpellAbilityEffect`.
#[forge_engine_macros::spell_effect(HauntEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let Some(source_id) = sa.source else { return };
    let controller = sa.activating_player;

    // Find what to haunt (target creature or trigger source)
    let haunt_target: Option<CardId> = if sa.uses_targeting() {
        sa.target_chosen.target_card
    } else {
        // Default: choose a creature on the battlefield
        let creatures: Vec<CardId> = ctx
            .game
            .cards
            .iter()
            .filter(|c| {
                c.zone == ZoneType::Battlefield
                    && c.type_line
                        .core_types
                        .iter()
                        .any(|ct| matches!(ct, forge_foundation::CoreType::Creature))
            })
            .map(|c| c.id)
            .collect();
        if creatures.is_empty() {
            None
        } else {
            ctx.agents[controller.index()].snapshot_state(ctx.game, ctx.mana_pools);
            ctx.agents[controller.index()].choose_single_card_for_zone_change(
                ctx.game,
                controller,
                &creatures,
                "Choose a creature to haunt",
                false,
            )
        }
    };

    let Some(target_id) = haunt_target else {
        return;
    };

    // Verify target is still on battlefield
    if ctx.game.card(target_id).zone != ZoneType::Battlefield {
        return;
    }

    // Exile the haunting card
    let old_zone = ctx.game.card(source_id).zone;
    if old_zone != ZoneType::Exile {
        ctx.game
            .move_card(source_id, ZoneType::Exile, ctx.game.card(source_id).owner);
        emit_zone_trigger(ctx.trigger_handler, source_id, old_zone, ZoneType::Exile);
    }

    // Link: set exiled_by to the haunted creature
    // When the haunted creature dies, triggers check for cards with exiled_by pointing to it
    ctx.game.card_mut(source_id).set_exiled_by(Some(target_id));

    // Remember the haunted creature on the source
    ctx.game.card_mut(source_id).add_remembered_card(target_id);
}
