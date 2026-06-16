//! RemoveFromMatch — remove cards from the entire match (Conspiracy).
//! Ported from Java's RemoveFromMatchEffect: permanently removes cards
//! from all game zones, ceasing to exist.

use forge_foundation::ZoneType;

use super::EffectContext;
use crate::ids::CardId;

/// Struct form of this effect so it can participate in the
/// `SpellAbilityEffect` trait hierarchy — mirrors Java's
/// `RemoveFromMatchEffect` class extending `SpellAbilityEffect`.
#[manabrew_engine_macros::spell_effect(RemoveFromMatchEffect)]
fn resolve(ctx: &mut EffectContext, sa: &crate::spellability::SpellAbility) {
    let targets: Vec<CardId> = if let Some(target) = sa.target_chosen.target_card {
        vec![target]
    } else if let Some(source) = sa.source {
        ctx.game.card(source).remembered_cards.clone()
    } else {
        return;
    };

    for card_id in targets {
        // Move to None zone — card ceases to exist
        let old_zone = ctx.game.card(card_id).zone;
        let owner = ctx.game.card(card_id).owner;
        ctx.move_card(card_id, ZoneType::None, owner);
        super::emit_zone_trigger(ctx.trigger_handler, card_id, old_zone, ZoneType::None);
    }
}
